-- ============================================================================
-- phase2_test.sql — напоминания, повторяющиеся задачи, корзина, подписки
--
-- Запускается после rls_test.sql и переиспользует его каркас (schema tests) и
-- созданные там семьи A и B.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '── 9. генерация задач из гарантий ──────────────────────────────'

reset role;
set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

-- Три вещи: гарантия на исходе, гарантия далеко, гарантия из типового срока
do $$
declare hid uuid := tests.uid('a_household');
begin
  insert into public.items (household_id, name, warranty_until, created_by)
  values (hid, 'Микроволновка', current_date + 10, auth.uid())
  returning id into strict hid;
  perform tests.put('soon_item', hid::text);
end;
$$;

do $$
declare hid uuid := tests.uid('a_household');
  new_id uuid;
begin
  insert into public.items (household_id, name, warranty_until, created_by)
  values (hid, 'Новая плита', current_date + 400, auth.uid())
  returning id into new_id;
  perform tests.put('far_item', new_id::text);

  -- Срок не указан, но у категории он типовой: 24 месяца у холодильников.
  -- Дата покупки выбрана так, чтобы расчётный конец гарантии уверенно попал
  -- внутрь окна предупреждения, а не на его границу
  insert into public.items (household_id, name, category_id, purchased_at, created_by)
  values (hid, 'Холодильник из категории', 'kitchen.fridge',
          (current_date - interval '23 months' - interval '10 days')::date, auth.uid())
  returning id into new_id;
  perform tests.put('category_item', new_id::text);
end;
$$;

reset role;

do $$
declare created int;
begin
  created := public.generate_due_tasks(tests.uid('a_household'));
  perform tests.ok('созданы задачи по истекающим гарантиям', created >= 2);

  perform tests.ok('задача для вещи с близкой гарантией есть',
    exists (select 1 from public.tasks
            where item_id = tests.uid('soon_item') and source = 'warranty'));

  perform tests.ok('для далёкой гарантии задачи нет',
    not exists (select 1 from public.tasks
                where item_id = tests.uid('far_item')));

  perform tests.ok('типовой срок категории учитывается',
    exists (select 1 from public.tasks
            where item_id = tests.uid('category_item') and source = 'warranty'));
end;
$$;

do $$
declare
  before_count int;
  created int;
begin
  select count(*) into before_count from public.tasks where source = 'warranty';
  created := public.generate_due_tasks(tests.uid('a_household'));

  perform tests.ok('повторный запуск не создаёт дублей', created = 0);
  perform tests.ok('число задач не изменилось',
    (select count(*) from public.tasks where source = 'warranty') = before_count);
end;
$$;

do $$
begin
  perform tests.ok('задачи созданы только в своей семье',
    not exists (
      select 1 from public.tasks
      where household_id = tests.uid('b_household') and source = 'warranty'
    ));
end;
$$;


\echo ''
\echo '── 10. обслуживание и расходники ───────────────────────────────'

do $$
declare hid uuid := tests.uid('a_household');
begin
  insert into public.service_records
    (household_id, item_id, kind, performed_at, next_due_at)
  values (hid, tests.uid('a_fridge'), 'maintenance',
          current_date - 360, current_date + 3);

  insert into public.consumables
    (household_id, item_id, name, part_number, next_due_at)
  values (hid, tests.uid('a_fridge'), 'Фильтр воды', 'DA29-00003G', current_date + 2);

  perform public.generate_due_tasks(hid);

  perform tests.ok('подошедшее ТО превратилось в задачу',
    exists (select 1 from public.tasks
            where item_id = tests.uid('a_fridge') and source = 'maintenance'));

  perform tests.ok('расходник превратился в задачу',
    exists (select 1 from public.tasks
            where source = 'consumable' and title like '%Фильтр воды%'));

  perform tests.ok('артикул попал в описание задачи',
    exists (select 1 from public.tasks
            where source = 'consumable' and description like '%DA29-00003G%'));
end;
$$;


\echo ''
\echo '── 11. повторяющиеся задачи ────────────────────────────────────'

do $$
declare
  hid uuid := tests.uid('a_household');
  task_id uuid;
begin
  insert into public.tasks (household_id, title, interval_days, due_at, source)
  values (hid, 'Менять фильтр в кувшине', 180, now(), 'manual')
  returning id into task_id;
  perform tests.put('recurring_task', task_id::text);

  update public.tasks
  set status = 'done', completed_at = now()
  where id = task_id;

  perform tests.ok('после закрытия появилась следующая',
    (select count(*) from public.tasks
     where title = 'Менять фильтр в кувшине' and status = 'open') = 1);

  perform tests.ok('следующая назначена через интервал',
    (select due_at::date from public.tasks
     where title = 'Менять фильтр в кувшине' and status = 'open')
    = (current_date + 180));
end;
$$;

do $$
declare
  hid uuid := tests.uid('a_household');
  task_id uuid;
begin
  insert into public.tasks (household_id, title, due_at, source)
  values (hid, 'Разовая задача', now(), 'manual')
  returning id into task_id;

  update public.tasks set status = 'done', completed_at = now() where id = task_id;

  perform tests.ok('разовая задача не повторяется',
    (select count(*) from public.tasks where title = 'Разовая задача') = 1);
end;
$$;


\echo ''
\echo '── 12. очередь уведомлений ─────────────────────────────────────'

do $$
declare queued int;
begin
  queued := public.queue_task_notifications();
  perform tests.ok('уведомления поставлены в очередь', queued > 0);

  perform tests.ok('гостю уведомления не ставятся',
    not exists (
      select 1 from public.notifications
      where user_id = '44444444-4444-4444-4444-444444444444'
    ));

  perform tests.ok('участник уведомления получает',
    exists (
      select 1 from public.notifications
      where user_id = '22222222-2222-2222-2222-222222222222'
    ));

  perform tests.ok('в уведомлении есть ссылка на карточку',
    exists (select 1 from public.notifications where url like '/item/%'));
end;
$$;

do $$
declare second_run int;
begin
  second_run := public.queue_task_notifications();
  perform tests.ok('повторный запуск не дублирует уведомления', second_run = 0);
end;
$$;


\echo ''
\echo '── 13. корзина ─────────────────────────────────────────────────'

do $$
declare
  hid uuid := tests.uid('a_household');
  old_id uuid;
  fresh_id uuid;
  purged int;
begin
  insert into public.items (household_id, name, deleted_at)
  values (hid, 'Давно удалённое', now() - interval '40 days')
  returning id into old_id;

  insert into public.items (household_id, name, deleted_at)
  values (hid, 'Удалено вчера', now() - interval '1 day')
  returning id into fresh_id;

  purged := public.purge_deleted();

  perform tests.ok('старое удалено окончательно',
    not exists (select 1 from public.items where id = old_id));
  perform tests.ok('недавнее осталось — его ещё можно вернуть',
    exists (select 1 from public.items where id = fresh_id));
  perform tests.ok('purge_deleted вернул число удалённых', purged >= 1);
end;
$$;


\echo ''
\echo '── 14. подписки на push ────────────────────────────────────────'

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (auth.uid(), 'https://push.example/alice', 'key-a', 'auth-a');

  perform tests.ok('своя подписка видна',
    (select count(*) from public.push_subscriptions) = 1);

  perform tests.raises('нельзя подписать другого человека',
    format('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
            values (%L, %L, %L, %L)',
           '33333333-3333-3333-3333-333333333333', 'https://push.example/hack', 'k', 'a'));
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  perform tests.ok('чужая подписка не видна',
    (select count(*) from public.push_subscriptions) = 0);
  perform tests.ok('чужие уведомления не видны',
    (select count(*) from public.notifications) = 0);
end;
$$;


\echo ''
\echo '── 15. пересчёт своих задач ────────────────────────────────────'

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare
  hid uuid := tests.uid('a_household');
  result int;
begin
  insert into public.items (household_id, name, warranty_until, created_by)
  values (hid, 'Пылесос с гарантией', current_date + 5, auth.uid());

  result := public.refresh_my_tasks();
  perform tests.ok('refresh_my_tasks создал задачу', result = 1);

  perform tests.ok('задача появилась в своей семье',
    exists (select 1 from public.tasks
            where title like '%Пылесос с гарантией%' and source = 'warranty'));
end;
$$;

do $$ begin perform auth.logout(); end; $$;

do $$
begin
  perform tests.raises('без входа пересчёт недоступен',
    'select public.refresh_my_tasks()');
end;
$$;

reset role;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  ФАЗА 2: ВСЕ ТЕСТЫ ПРОЙДЕНЫ'
\echo '════════════════════════════════════════════════════════════════'
\echo ''
