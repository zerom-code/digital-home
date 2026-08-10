-- ============================================================================
-- 0002_rls.sql — Row Level Security
--
-- RLS здесь единственный слой авторизации: клиент ходит в базу напрямую,
-- промежуточного API нет. Ошибка в политике равна утечке данных всех семей.
-- ============================================================================

-- ─── Вспомогательные функции ────────────────────────────────────────────────
--
-- Политика на household_members, которая сама читает household_members, уходит
-- в бесконечную рекурсию: Postgres применяет политику к запросу внутри
-- политики. security definer выполняет функцию с правами владельца и обходит
-- RLS, что рекурсию разрывает.
--
-- set search_path = public обязателен: без него функция уязвима к подмене схемы.

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_household_role(hid uuid, roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = auth.uid()
      and m.role = any(roles)
  );
$$;

-- Сокращение для «может писать»: все, кроме гостя
create or replace function public.can_write(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.has_household_role(hid, array['owner', 'admin', 'member']);
$$;

revoke execute on function public.is_household_member(uuid)      from public;
revoke execute on function public.has_household_role(uuid, text[]) from public;
revoke execute on function public.can_write(uuid)                from public;

grant execute on function public.is_household_member(uuid)       to authenticated;
grant execute on function public.has_household_role(uuid, text[]) to authenticated;
grant execute on function public.can_write(uuid)                 to authenticated;


-- ─── Профили ────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- Видим профили тех, с кем состоим в одной семье — иначе в списке участников
-- будут безымянные строки
create policy profiles_select_family on public.profiles
  for select using (
    exists (
      select 1
      from public.household_members me
      join public.household_members them using (household_id)
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());


-- ─── Семьи ──────────────────────────────────────────────────────────────────

alter table public.households enable row level security;

create policy households_select on public.households
  for select using (public.is_household_member(id));

create policy households_insert on public.households
  for insert with check (created_by = auth.uid());

create policy households_update on public.households
  for update using      (public.has_household_role(id, array['owner', 'admin']))
              with check (public.has_household_role(id, array['owner', 'admin']));

create policy households_delete on public.households
  for delete using (public.has_household_role(id, array['owner']));


alter table public.household_members enable row level security;

create policy members_select on public.household_members
  for select using (public.is_household_member(household_id));

create policy members_modify on public.household_members
  for all using      (public.has_household_role(household_id, array['owner', 'admin']))
          with check (public.has_household_role(household_id, array['owner', 'admin']));

-- Выйти из семьи можно всегда — это про себя, а не про чужие строки
create policy members_leave on public.household_members
  for delete using (user_id = auth.uid());


alter table public.household_invites enable row level security;

create policy invites_select on public.household_invites
  for select using (public.is_household_member(household_id));

create policy invites_modify on public.household_invites
  for all using      (public.has_household_role(household_id, array['owner', 'admin']))
          with check (public.has_household_role(household_id, array['owner', 'admin']));


-- ─── Справочник категорий: читают все аутентифицированные ───────────────────

alter table public.item_categories enable row level security;

create policy categories_read on public.item_categories
  for select to authenticated using (true);
-- политики записи нет: справочник наполняется миграцией


-- ─── Вещи: отдельно, из-за режима арендатора ────────────────────────────────

alter table public.items enable row level security;

create policy items_select on public.items
  for select using (
    public.can_write(household_id)
    or (public.is_household_member(household_id) and guest_visible)
  );

create policy items_modify on public.items
  for all using (public.can_write(household_id))
          with check (public.can_write(household_id));


-- ─── Типовая пара политик на остальные таблицы с household_id ───────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'homes', 'spaces', 'item_fields', 'documents', 'contacts',
    'service_records', 'tasks', 'consumables', 'energy_profiles',
    'tariffs', 'meters', 'meter_readings', 'activity',
    'ai_settings', 'ai_usage'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %1$s_select on public.%1$I
         for select using (public.is_household_member(household_id))', t);

    execute format(
      'create policy %1$s_modify on public.%1$I
         for all using (public.can_write(household_id))
                 with check (public.can_write(household_id))', t);
  end loop;
end;
$$;


-- ─── item_contacts: household_id нет, идём через items ──────────────────────

alter table public.item_contacts enable row level security;

create policy item_contacts_select on public.item_contacts
  for select using (
    exists (
      select 1 from public.items i
      where i.id = item_contacts.item_id
        and public.is_household_member(i.household_id)
    )
  );

create policy item_contacts_modify on public.item_contacts
  for all using (
    exists (
      select 1 from public.items i
      where i.id = item_contacts.item_id
        and public.can_write(i.household_id)
    )
  )
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_contacts.item_id
        and public.can_write(i.household_id)
    )
  );


-- ─── Права на таблицы ───────────────────────────────────────────────────────
-- RLS фильтрует строки, GRANT открывает саму таблицу. Нужны оба.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
