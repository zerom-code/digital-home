-- ============================================================================
-- 0005_tasks_and_push.sql — фаза 2: напоминания
--
-- Задачи в приложении почти никогда не заводят руками. Их источник —
-- то, что уже известно про вещи: гарантия заканчивается, интервал ТО подошёл,
-- расходник пора менять. Здесь та машинка, которая превращает эти данные в
-- строки в tasks и в очередь уведомлений.
-- ============================================================================

-- ─── Подписки на push ───────────────────────────────────────────────────────
--
-- Подписка привязана к устройству, а не к человеку: у одного пользователя их
-- столько, сколько браузеров и телефонов. На iOS подписка появляется только
-- после установки на домашний экран (docs/05-architecture.md).

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  -- Push-сервис ответил, что подписка мертва: больше не пробуем
  failed_at    timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id)
  where failed_at is null;


-- ─── Очередь уведомлений ────────────────────────────────────────────────────
--
-- Отдельная таблица, а не отправка напрямую из триггера: pg_cron не должен
-- зависеть от доступности push-сервиса, а неудачную отправку надо уметь
-- повторить.

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete cascade,
  title        text not null,
  body         text,
  url          text,
  status       text not null default 'queued'
               check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  error        text,
  send_after   timestamptz not null default now(),
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_pending_idx on public.notifications (send_after)
  where status = 'queued';


-- ============================================================================
-- Генерация задач из того, что уже известно
-- ============================================================================

-- За сколько дней предупреждать об окончании гарантии
create or replace function public.warranty_warning_days()
returns int language sql immutable as $$ select 30 $$;

/**
 * Считает дату окончания гарантии так же, как это делает клиент
 * (src/lib/warranty.ts): своя дата побеждает расчётную, срок берётся из
 * вещи, а если его нет — из типового срока категории.
 */
create or replace function public.item_warranty_until(p_item public.items)
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_item.warranty_until,
    case
      when p_item.purchased_at is null then null
      -- Скобки существенны: interval::date — ошибка, нужен именно
      -- (date + interval)::date
      else (
        p_item.purchased_at + make_interval(
          months => coalesce(
            p_item.warranty_months,
            (select c.default_warranty_months
               from public.item_categories c
              where c.id = p_item.category_id)
          )
        )
      )::date
    end
  );
$$;

/**
 * Создаёт задачи по наступившим срокам.
 *
 * Идемпотентна: повторный вызов не плодит дубли, потому что для каждой пары
 * «вещь + источник» открытая задача может быть только одна. Это важно —
 * функция запускается ежедневно.
 *
 * Возвращает число созданных задач.
 */
create or replace function public.generate_due_tasks(p_household uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  created int := 0;
  affected int;
begin
  -- 1. Гарантии на исходе
  insert into public.tasks (household_id, item_id, title, description, due_at, source)
  select
    i.household_id,
    i.id,
    'Заканчивается гарантия: ' || i.name,
    'Гарантия действует до ' || to_char(public.item_warranty_until(i), 'DD.MM.YYYY')
      || '. Если с вещью что-то не так — сейчас последний момент обратиться.',
    (public.item_warranty_until(i) - public.warranty_warning_days())::timestamptz,
    'warranty'
  from public.items i
  where i.deleted_at is null
    and i.status = 'active'
    and (p_household is null or i.household_id = p_household)
    and public.item_warranty_until(i) is not null
    and public.item_warranty_until(i) >= current_date
    and public.item_warranty_until(i) <= current_date + public.warranty_warning_days()
    and not exists (
      select 1 from public.tasks t
      where t.item_id = i.id
        and t.source = 'warranty'
        and t.deleted_at is null
        and t.status = 'open'
    );

  get diagnostics affected = row_count;
  created := created + affected;

  -- 2. Подошедшее обслуживание
  insert into public.tasks (household_id, item_id, title, description, due_at, source)
  select distinct on (s.item_id)
    s.household_id,
    s.item_id,
    'Пора обслужить: ' || i.name,
    'В прошлый раз — ' || to_char(s.performed_at, 'DD.MM.YYYY'),
    s.next_due_at::timestamptz,
    'maintenance'
  from public.service_records s
  join public.items i on i.id = s.item_id
  where s.deleted_at is null
    and i.deleted_at is null
    and (p_household is null or s.household_id = p_household)
    and s.next_due_at is not null
    and s.next_due_at <= current_date + 7
    and not exists (
      select 1 from public.tasks t
      where t.item_id = s.item_id
        and t.source = 'maintenance'
        and t.deleted_at is null
        and t.status = 'open'
    )
  order by s.item_id, s.next_due_at desc;

  get diagnostics affected = row_count;
  created := created + affected;

  -- 3. Расходники
  insert into public.tasks (household_id, item_id, title, description, due_at, source)
  select
    c.household_id,
    c.item_id,
    'Пора менять: ' || coalesce(c.name, 'расходник'),
    case when c.part_number is not null
      then 'Артикул: ' || c.part_number
      else null
    end,
    c.next_due_at::timestamptz,
    'consumable'
  from public.consumables c
  where c.deleted_at is null
    and (p_household is null or c.household_id = p_household)
    and c.next_due_at is not null
    and c.next_due_at <= current_date + 7
    and not exists (
      select 1 from public.tasks t
      where t.item_id is not distinct from c.item_id
        and t.source = 'consumable'
        and t.deleted_at is null
        and t.status = 'open'
    );

  get diagnostics affected = row_count;
  created := created + affected;

  return created;
end;
$$;


/**
 * Ставит уведомления в очередь по свежесозданным задачам.
 *
 * Шлём всем, кто может писать: гостю напоминание про гарантию не нужно и
 * не должно быть видно.
 */
create or replace function public.queue_task_notifications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  queued int;
begin
  insert into public.notifications (household_id, user_id, task_id, title, body, url)
  select
    t.household_id,
    m.user_id,
    t.id,
    t.title,
    t.description,
    case when t.item_id is not null then '/item/' || t.item_id else '/tasks' end
  from public.tasks t
  join public.household_members m on m.household_id = t.household_id
  where t.status = 'open'
    and t.deleted_at is null
    and t.due_at is not null
    and t.due_at <= now()
    and m.role in ('owner', 'admin', 'member')
    and not exists (
      select 1 from public.notifications n
      where n.task_id = t.id and n.user_id = m.user_id
    );

  get diagnostics queued = row_count;
  return queued;
end;
$$;


/**
 * Повторяющаяся задача: закрыли — сразу заводим следующую.
 *
 * Без этого «менять фильтр раз в полгода» пришлось бы заводить руками
 * каждые полгода, то есть не заводить никогда.
 */
create or replace function public.reschedule_recurring_task()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done'
     and old.status <> 'done'
     and new.interval_days is not null
     and new.interval_days > 0
     and new.deleted_at is null
  then
    insert into public.tasks
      (household_id, item_id, space_id, title, description,
       due_at, interval_days, assignee_id, source, created_by)
    values
      (new.household_id, new.item_id, new.space_id, new.title, new.description,
       coalesce(new.completed_at, now()) + make_interval(days => new.interval_days),
       new.interval_days, new.assignee_id, new.source, new.created_by);
  end if;

  return new;
end;
$$;

create trigger trg_tasks_reschedule
  after update on public.tasks
  for each row execute function public.reschedule_recurring_task();


/**
 * Чистка корзины.
 *
 * Мягко удалённое живёт 30 дней — этого хватает, чтобы заметить ошибку.
 * Дальше удаляем по-настоящему, иначе база растёт мусором вечно.
 */
create or replace function public.purge_deleted(p_older_than interval default '30 days')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  total int := 0;
  affected int;
  target text;
begin
  foreach target in array array[
    'items', 'spaces', 'homes', 'documents', 'tasks',
    'contacts', 'service_records', 'consumables', 'meters'
  ]
  loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - $1',
      target
    ) using p_older_than;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;

  return total;
end;
$$;


-- ─── RLS для новых таблиц ───────────────────────────────────────────────────

alter table public.push_subscriptions enable row level security;

-- Подписка — про устройство конкретного человека, семья тут ни при чём
create policy push_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.notifications enable row level security;

-- Уведомления только читаем: ставит их в очередь сервер
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());


-- ─── Права ──────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notifications to authenticated;

/**
 * То же самое, но только по своим семьям.
 *
 * Клиенту полезно пересчитать задачи сразу после того, как он ввёл дату
 * покупки, не дожидаясь ночного запуска. Но давать ему generate_due_tasks()
 * без аргумента нельзя: она прошлась бы по всем семьям в базе.
 */
create or replace function public.refresh_my_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  total int := 0;
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти в приложение' using errcode = '28000';
  end if;

  for hid in
    select household_id
    from public.household_members
    where user_id = auth.uid()
      and role in ('owner', 'admin', 'member')
  loop
    total := total + public.generate_due_tasks(hid);
  end loop;

  return total;
end;
$$;

revoke execute on function public.generate_due_tasks(uuid) from public;
revoke execute on function public.queue_task_notifications() from public;
revoke execute on function public.purge_deleted(interval) from public;
revoke execute on function public.refresh_my_tasks() from public;

grant execute on function public.refresh_my_tasks() to authenticated;


-- ============================================================================
-- Расписание
--
-- pg_cron и pg_net есть в Supabase, но их нет в обычном Postgres, на котором
-- гоняются тесты. Поэтому включаем по наличию, а не безусловно.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- Каждый день в 6 утра по Киеву (03:00 UTC): создать задачи и поставить
    -- уведомления в очередь. Раньше не нужно — это не срочные новости.
    perform cron.schedule(
      'domovoy-daily-tasks',
      '0 3 * * *',
      $cron$
        select public.generate_due_tasks();
        select public.queue_task_notifications();
      $cron$
    );

    -- Раз в неделю подчищаем корзину
    perform cron.schedule(
      'domovoy-purge-trash',
      '0 4 * * 0',
      $cron$ select public.purge_deleted() $cron$
    );
  else
    raise notice 'pg_cron недоступен — расписание не создано (это нормально для локального прогона тестов)';
  end if;
end;
$$;
