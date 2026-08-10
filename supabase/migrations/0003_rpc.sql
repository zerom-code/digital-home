-- ============================================================================
-- 0003_rpc.sql — функции, вызываемые клиентом через supabase.rpc()
--
-- Сюда попадает только то, что нельзя сделать обычной вставкой под RLS.
-- Всё остальное клиент пишет напрямую в таблицы.
-- ============================================================================

-- ─── Создание семьи ─────────────────────────────────────────────────────────
--
-- Операция двухшаговая: вставить households, затем себя в household_members.
-- Между шагами пользователь ещё не член семьи, поэтому под обычной RLS второй
-- шаг не проходит. Делаем атомарно в security definer.

create or replace function public.create_household(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;

  insert into public.households (name, created_by)
  values (nullif(btrim(coalesce(p_name, '')), ''), uid)
  returning id into hid;

  insert into public.household_members (household_id, user_id, role)
  values (hid, uid, 'owner');

  insert into public.ai_settings (household_id)
  values (hid);

  return hid;
end;
$$;


-- ─── Приём приглашения ──────────────────────────────────────────────────────
--
-- Та же причина: приглашённый ещё не член семьи, обычная вставка невозможна.
-- Здесь же проверяются срок, лимит использований и отзыв.

create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.household_invites%rowtype;
begin
  if uid is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;

  select * into inv
  from public.household_invites
  where code = upper(btrim(p_code))
  for update;

  if not found then
    raise exception 'Такого приглашения нет' using errcode = 'P0002';
  end if;

  if inv.revoked_at is not null then
    raise exception 'Приглашение отозвано' using errcode = 'P0001';
  end if;

  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception 'Срок приглашения истёк' using errcode = 'P0001';
  end if;

  if inv.max_uses is not null and inv.used_count >= inv.max_uses then
    raise exception 'Приглашение уже использовано' using errcode = 'P0001';
  end if;

  -- Повторный переход по той же ссылке не должен ни падать, ни жечь лимит
  if exists (
    select 1 from public.household_members
    where household_id = inv.household_id and user_id = uid
  ) then
    return inv.household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (inv.household_id, uid, inv.role);

  update public.household_invites
  set used_count = used_count + 1
  where id = inv.id;

  return inv.household_id;
end;
$$;


-- ─── Поиск по всему дому ────────────────────────────────────────────────────
--
-- security invoker (по умолчанию), поэтому RLS применяется как обычно и чужие
-- семьи не найдутся. Полнотекстовый поиск по-русски плюс подстрока — чтобы
-- работали серийники, артикулы и латиница, которые стеммер не разбирает.

create or replace function public.search_items(p_query text)
returns setof public.items
language sql
stable
set search_path = public
as $$
  with q as (
    select
      btrim(coalesce(p_query, ''))            as raw,
      plainto_tsquery('russian', coalesce(p_query, '')) as tsq
  )
  select i.*
  from public.items i, q
  where q.raw <> ''
    and i.deleted_at is null
    and (
      i.search_vector @@ q.tsq
      or i.name                        ilike '%' || q.raw || '%'
      or coalesce(i.brand, '')         ilike '%' || q.raw || '%'
      or coalesce(i.model, '')         ilike '%' || q.raw || '%'
      or coalesce(i.serial_number, '') ilike '%' || q.raw || '%'
      or coalesce(i.notes, '')         ilike '%' || q.raw || '%'
    )
  order by
    ts_rank(i.search_vector, q.tsq) desc,
    i.name
  limit 50;
$$;


-- ─── Права ──────────────────────────────────────────────────────────────────

revoke execute on function public.create_household(text) from public;
revoke execute on function public.accept_invite(text)    from public;
revoke execute on function public.search_items(text)     from public;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.accept_invite(text)    to authenticated;
grant execute on function public.search_items(text)     to authenticated;
