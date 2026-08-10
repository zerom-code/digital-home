-- ============================================================================
-- rls_test.sql — проверка изоляции семей и целостности данных
--
-- Самая опасная часть проекта: клиент ходит в базу напрямую, поэтому дыра в
-- политике означает, что чужая семья видит вашу квартиру. Здесь это
-- проверяется на живом Postgres.
--
-- Запуск: bash scripts/db-test.sh
--
-- Важно: RLS не применяется к владельцу таблиц, поэтому проверки выполняются
-- под ролью authenticated — ровно так же, как это делает PostgREST в Supabase.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- ─── Каркас тестов ──────────────────────────────────────────────────────────

reset role;

create schema if not exists tests;

create table if not exists tests.state (k text primary key, v text);

create or replace function tests.put(p_key text, p_value text)
returns void language sql as $$
  insert into tests.state values (p_key, p_value)
  on conflict (k) do update set v = excluded.v;
$$;

create or replace function tests.get(p_key text)
returns text language sql stable as $$
  select v from tests.state where k = p_key;
$$;

create or replace function tests.uid(p_key text)
returns uuid language sql stable as $$
  select tests.get(p_key)::uuid;
$$;

create or replace function tests.ok(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice '  ok    %', p_name;
  else
    raise exception 'ПРОВАЛ: %', p_name;
  end if;
end;
$$;

-- Проверяет, что запрос падает: ожидаемое срабатывание ограничения или политики
create or replace function tests.raises(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  ok    % [%]', p_name, left(sqlerrm, 55);
    return;
  end;
  raise exception 'ПРОВАЛ: % — ожидалась ошибка, но запрос прошёл', p_name;
end;
$$;

grant usage on schema tests to authenticated;
grant select, insert, update, delete on tests.state to authenticated;
grant execute on all functions in schema tests to authenticated;


-- ============================================================================
-- Подготовка: пять пользователей, две семьи
-- ============================================================================

\echo ''
\echo '── подготовка ──────────────────────────────────────────────────'

delete from auth.users where email like '%@test.local';
delete from tests.state;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local', '{"full_name":"Алиса"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local',   '{"full_name":"Боб"}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.local', '{"full_name":"Кэрол"}'),
  ('44444444-4444-4444-4444-444444444444', 'dave@test.local',  '{"full_name":"Дэйв"}'),
  ('55555555-5555-5555-5555-555555555555', 'erin@test.local',  '{"full_name":"Эрин"}');

do $$
begin
  perform tests.ok('профиль заводится триггером при регистрации',
    (select count(*) from public.profiles where id::text like '%-%'
       and id in ('11111111-1111-1111-1111-111111111111',
                  '55555555-5555-5555-5555-555555555555')) = 2);
  perform tests.ok('display_name берётся из метаданных',
    (select display_name from public.profiles
     where id = '11111111-1111-1111-1111-111111111111') = 'Алиса');
end;
$$;


-- ─── Семья A: Алиса ─────────────────────────────────────────────────────────

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare
  hid uuid;
  home_id uuid;
  kitchen uuid;
  fridge uuid;
begin
  hid := public.create_household('Квартира Алисы');
  perform tests.put('a_household', hid::text);

  insert into public.homes (household_id, name, kind, created_by)
  values (hid, 'Квартира', 'apartment', auth.uid())
  returning id into home_id;
  perform tests.put('a_home', home_id::text);

  insert into public.spaces (household_id, home_id, name, kind, icon, created_by)
  values (hid, home_id, 'Кухня', 'kitchen', '🍳', auth.uid())
  returning id into kitchen;
  perform tests.put('a_kitchen', kitchen::text);

  insert into public.items
    (household_id, home_id, space_id, category_id, name, brand, model,
     serial_number, purchased_at, guest_visible, created_by)
  values
    (hid, home_id, kitchen, 'kitchen.fridge', 'Холодильник', 'Samsung',
     'RB37', 'SN-777-ALICE', date '2024-03-01', true, auth.uid())
  returning id into fridge;
  perform tests.put('a_fridge', fridge::text);

  insert into public.items (household_id, home_id, space_id, name, created_by)
  values (hid, home_id, kitchen, 'Секретная кофемашина', auth.uid());

  insert into public.tasks (household_id, item_id, title, created_by)
  values (hid, fridge, 'Проверить гарантию', auth.uid());

  insert into public.contacts (household_id, name, phone, created_by)
  values (hid, 'Мастер Иван', '+380000000001', auth.uid());

  insert into public.documents (household_id, item_id, kind, title, uploaded_by)
  values (hid, fridge, 'manual', 'Инструкция RB37', auth.uid());

  perform tests.ok('create_household сделал автора владельцем',
    public.has_household_role(hid, array['owner']));
  perform tests.ok('у семьи сразу есть ai_settings, выключенные по умолчанию',
    (select not enabled from public.ai_settings where household_id = hid));
end;
$$;

-- Боб — участник, Дэйв — гость
do $$
declare hid uuid := tests.uid('a_household');
begin
  insert into public.household_members (household_id, user_id, role) values
    (hid, '22222222-2222-2222-2222-222222222222', 'member'),
    (hid, '44444444-4444-4444-4444-444444444444', 'guest');
end;
$$;


-- ─── Семья B: Кэрол ─────────────────────────────────────────────────────────

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
declare
  hid uuid;
  home_id uuid;
  bath uuid;
begin
  hid := public.create_household('Квартира Кэрол');
  perform tests.put('b_household', hid::text);

  insert into public.homes (household_id, name, kind, created_by)
  values (hid, 'Квартира', 'apartment', auth.uid())
  returning id into home_id;
  perform tests.put('b_home', home_id::text);

  insert into public.spaces (household_id, home_id, name, kind, created_by)
  values (hid, home_id, 'Ванная', 'bath', auth.uid())
  returning id into bath;
  perform tests.put('b_bath', bath::text);

  insert into public.items (household_id, home_id, space_id, name, model, created_by)
  values (hid, home_id, bath, 'Бойлер', 'Ariston-80', auth.uid());
end;
$$;


-- ============================================================================
-- 1. Изоляция семей
-- ============================================================================

\echo ''
\echo '── 1. изоляция семей ───────────────────────────────────────────'

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare hid_b uuid := tests.uid('b_household');
begin
  perform tests.ok('Алиса видит свои 2 вещи',
    (select count(*) from public.items) = 2);
  perform tests.ok('Алиса не видит ни одной вещи Кэрол',
    (select count(*) from public.items where household_id = hid_b) = 0);
  perform tests.ok('Алиса не видит дома Кэрол',
    (select count(*) from public.homes where household_id = hid_b) = 0);
  perform tests.ok('Алиса не видит комнаты Кэрол',
    (select count(*) from public.spaces where household_id = hid_b) = 0);
  perform tests.ok('Алиса не видит семью Кэрол',
    (select count(*) from public.households where id = hid_b) = 0);
  perform tests.ok('Алиса не видит участников семьи Кэрол',
    (select count(*) from public.household_members where household_id = hid_b) = 0);
  perform tests.ok('Алиса не видит профиль Кэрол',
    (select count(*) from public.profiles
     where id = '33333333-3333-3333-3333-333333333333') = 0);
  perform tests.ok('Алиса видит профиль Боба — они в одной семье',
    (select count(*) from public.profiles
     where id = '22222222-2222-2222-2222-222222222222') = 1);
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
declare hid_a uuid := tests.uid('a_household');
begin
  perform tests.ok('Кэрол видит только свой бойлер',
    (select count(*) from public.items) = 1);
  perform tests.ok('Кэрол не видит задачи семьи A',
    (select count(*) from public.tasks where household_id = hid_a) = 0);
  perform tests.ok('Кэрол не видит контакты семьи A',
    (select count(*) from public.contacts where household_id = hid_a) = 0);
  perform tests.ok('Кэрол не видит документы семьи A',
    (select count(*) from public.documents where household_id = hid_a) = 0);
end;
$$;

-- Попытка дописаться в чужую семью
do $$
declare
  hid_a uuid := tests.uid('a_household');
  affected int;
begin
  perform tests.raises('Кэрол не может создать вещь в семье A',
    format('insert into public.items (household_id, name) values (%L, %L)',
           hid_a, 'Троянский конь'));

  -- UPDATE не падает, а просто не находит строк: политика фильтрует их
  -- ещё на чтении. Для клиента это выглядит как «ничего не изменилось».
  update public.items set name = 'Взломано' where household_id = hid_a;
  get diagnostics affected = row_count;
  perform tests.ok('UPDATE чужой вещи не затрагивает ни одной строки', affected = 0);

  delete from public.items where household_id = hid_a;
  get diagnostics affected = row_count;
  perform tests.ok('DELETE чужой вещи не затрагивает ни одной строки', affected = 0);
end;
$$;


-- ============================================================================
-- 2. Роли: гость, участник, аноним
-- ============================================================================

\echo ''
\echo '── 2. роли ─────────────────────────────────────────────────────'

do $$ begin perform auth.login_as('44444444-4444-4444-4444-444444444444'); end; $$;

do $$
declare hid_a uuid := tests.uid('a_household');
begin
  perform tests.ok('гость видит только вещи с guest_visible',
    (select count(*) from public.items) = 1);
  perform tests.ok('гостю видна именно открытая вещь',
    (select name from public.items) = 'Холодильник');
  perform tests.raises('гость не может создавать вещи',
    format('insert into public.items (household_id, name) values (%L, %L)',
           hid_a, 'Вещь гостя'));
  perform tests.raises('гость не может приглашать',
    format('insert into public.household_invites (household_id, code) values (%L, %L)',
           hid_a, 'GUESTCODE'));
  perform tests.ok('гость всё же видит комнаты — иначе не найдёт инструкцию',
    (select count(*) from public.spaces) = 1);
end;
$$;

do $$ begin perform auth.login_as('22222222-2222-2222-2222-222222222222'); end; $$;

do $$
declare
  hid_a uuid := tests.uid('a_household');
  affected int;
begin
  perform tests.ok('участник видит все вещи семьи',
    (select count(*) from public.items) = 2);

  insert into public.items (household_id, name, created_by)
  values (hid_a, 'Пылесос Боба', auth.uid());
  get diagnostics affected = row_count;
  perform tests.ok('участник может создать вещь', affected = 1);

  perform tests.raises('участник не может менять состав семьи',
    format('insert into public.household_members (household_id, user_id, role)
            values (%L, %L, %L)',
           hid_a, '55555555-5555-5555-5555-555555555555', 'member'));
end;
$$;

do $$ begin perform auth.logout(); end; $$;

do $$
begin
  perform tests.ok('аноним не видит вещей',      (select count(*) from public.items) = 0);
  perform tests.ok('аноним не видит семей',      (select count(*) from public.households) = 0);
  perform tests.ok('аноним не видит участников', (select count(*) from public.household_members) = 0);
  perform tests.ok('справочник категорий читается всегда',
    (select count(*) from public.item_categories) = 99);
end;
$$;


-- ============================================================================
-- 3. Рекурсия политик
-- ============================================================================

\echo ''
\echo '── 3. рекурсия политик ─────────────────────────────────────────'

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  -- Наивная политика на household_members, читающая household_members, здесь
  -- ушла бы в бесконечную рекурсию и упала бы с ошибкой стека
  perform tests.ok('household_members читается без рекурсии',
    (select count(*) from public.household_members) = 3);
  perform tests.ok('households читается без рекурсии',
    (select count(*) from public.households) = 1);
end;
$$;


-- ============================================================================
-- 4. Триггеры целостности
-- ============================================================================

\echo ''
\echo '── 4. триггеры целостности ─────────────────────────────────────'

do $$
declare
  hid_a  uuid := tests.uid('a_household');
  bath_b uuid := tests.uid('b_bath');
  home_b uuid := tests.uid('b_home');
  kitchen uuid := tests.uid('a_kitchen');
begin
  perform tests.raises('вещь с чужим space_id не создаётся',
    format('insert into public.items (household_id, name, space_id)
            values (%L, %L, %L)', hid_a, 'Подлог', bath_b));

  perform tests.raises('вещь с чужим home_id не создаётся',
    format('insert into public.items (household_id, name, home_id)
            values (%L, %L, %L)', hid_a, 'Подлог', home_b));

  perform tests.raises('пустое название не проходит',
    format('insert into public.items (household_id, name) values (%L, %L)',
           hid_a, '   '));

  perform tests.raises('третий уровень вложенности пространств запрещён',
    format($q$
      with lvl2 as (
        insert into public.spaces (household_id, name, parent_id)
        values (%L, 'Шкаф', %L) returning id
      )
      insert into public.spaces (household_id, name, parent_id)
      select %L, 'Полка', id from lvl2
    $q$, hid_a, kitchen, hid_a));

  perform tests.raises('пространство не может быть родителем самому себе',
    format('update public.spaces set parent_id = id where id = %L', kitchen));
end;
$$;


-- ============================================================================
-- 5. Идемпотентность офлайн-записи и updated_at
-- ============================================================================

\echo ''
\echo '── 5. идемпотентность и updated_at ─────────────────────────────'

do $$
declare
  hid_a uuid := tests.uid('a_household');
  new_id uuid := gen_random_uuid();
begin
  perform tests.put('idem_item', new_id::text);

  -- Клиент сгенерировал UUID офлайн и отправил запись дважды
  insert into public.items (id, household_id, name, created_by)
  values (new_id, hid_a, 'Утюг', auth.uid())
  on conflict (id) do update set name = excluded.name;

  insert into public.items (id, household_id, name, created_by)
  values (new_id, hid_a, 'Утюг', auth.uid())
  on conflict (id) do update set name = excluded.name;

  perform tests.ok('повторная отправка из очереди не создала дубль',
    (select count(*) from public.items where id = new_id) = 1);
end;
$$;

-- Отдельными транзакциями: now() постоянна внутри одной
do $$
begin
  update public.items set notes = 'тронули'
  where id = tests.uid('idem_item');
end;
$$;

do $$
begin
  perform tests.ok('updated_at обновился триггером',
    (select updated_at > created_at from public.items
     where id = tests.uid('idem_item')));
end;
$$;

do $$
declare hid_a uuid := tests.uid('a_household');
begin
  update public.items set deleted_at = now()
  where id = tests.uid('idem_item');

  perform tests.ok('мягко удалённая вещь остаётся в таблице',
    (select count(*) from public.items where id = tests.uid('idem_item')) = 1);
  perform tests.ok('и отфильтровывается по deleted_at',
    (select count(*) from public.items
     where household_id = hid_a and deleted_at is null) = 3);
end;
$$;


-- ============================================================================
-- 6. Поиск
-- ============================================================================

\echo ''
\echo '── 6. поиск ────────────────────────────────────────────────────'

do $$
begin
  perform tests.ok('поиск по слову находит вещь',
    (select count(*) from public.search_items('холодильник')) = 1);
  perform tests.ok('поиск по серийнику работает',
    (select count(*) from public.search_items('SN-777-ALICE')) = 1);
  perform tests.ok('поиск по модели работает',
    (select count(*) from public.search_items('RB37')) = 1);
  perform tests.ok('пустой запрос ничего не возвращает',
    (select count(*) from public.search_items('   ')) = 0);
  perform tests.ok('удалённое в поиск не попадает',
    (select count(*) from public.search_items('Утюг')) = 0);
  perform tests.ok('чужая вещь не находится',
    (select count(*) from public.search_items('Ariston')) = 0);
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  perform tests.ok('Кэрол находит свой бойлер',
    (select count(*) from public.search_items('Ariston')) = 1);
  perform tests.ok('и не находит холодильник Алисы',
    (select count(*) from public.search_items('холодильник')) = 0);
end;
$$;


-- ============================================================================
-- 7. Приглашения
-- ============================================================================

\echo ''
\echo '── 7. приглашения ──────────────────────────────────────────────'

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare hid_a uuid := tests.uid('a_household');
begin
  insert into public.household_invites (household_id, code, role, max_uses, created_by)
  values (hid_a, 'GOODCODE', 'member', 5, auth.uid());

  insert into public.household_invites (household_id, code, role, created_by, revoked_at)
  values (hid_a, 'REVOKED', 'member', auth.uid(), now());

  insert into public.household_invites (household_id, code, role, created_by, expires_at)
  values (hid_a, 'EXPIRED', 'member', auth.uid(), now() - interval '1 day');

  insert into public.household_invites
    (household_id, code, role, created_by, max_uses, used_count)
  values (hid_a, 'USEDUP', 'member', auth.uid(), 1, 1);
end;
$$;

do $$ begin perform auth.login_as('55555555-5555-5555-5555-555555555555'); end; $$;

do $$
declare
  hid_a uuid := tests.uid('a_household');
  got uuid;
begin
  perform tests.raises('отозванное приглашение не принимается',
    'select public.accept_invite(''REVOKED'')');
  perform tests.raises('истёкшее приглашение не принимается',
    'select public.accept_invite(''EXPIRED'')');
  perform tests.raises('исчерпанное приглашение не принимается',
    'select public.accept_invite(''USEDUP'')');
  perform tests.raises('несуществующий код не принимается',
    'select public.accept_invite(''NOSUCHCODE'')');

  got := public.accept_invite('goodcode');   -- регистр не важен
  perform tests.ok('рабочее приглашение принято', got = hid_a);
  perform tests.ok('Эрин стала участником семьи A',
    public.has_household_role(hid_a, array['member']));
  perform tests.ok('и сразу видит вещи семьи',
    (select count(*) from public.items where deleted_at is null) = 3);

  -- Повторный переход по той же ссылке
  got := public.accept_invite('GOODCODE');
  perform tests.ok('повторный переход по ссылке не падает', got = hid_a);
end;
$$;

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  perform tests.ok('повторный переход не сжёг лимит использований',
    (select used_count from public.household_invites where code = 'GOODCODE') = 1);
  perform tests.ok('в семье A теперь четверо',
    (select count(*) from public.household_members
     where household_id = tests.uid('a_household')) = 4);
end;
$$;


-- ============================================================================
-- 8. Хранилище файлов
-- ============================================================================

\echo ''
\echo '── 8. хранилище ────────────────────────────────────────────────'

do $$
declare
  hid_a uuid := tests.uid('a_household');
  hid_b uuid := tests.uid('b_household');
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('docs', hid_a || '/' || tests.get('a_fridge') || '/manual.pdf', auth.uid());

  perform tests.ok('Алиса видит свой файл',
    (select count(*) from storage.objects) = 1);

  perform tests.raises('Алиса не может положить файл в папку чужой семьи',
    format('insert into storage.objects (bucket_id, name) values (%L, %L)',
           'docs', hid_b || '/x/y.pdf'));
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  perform tests.ok('Кэрол не видит файл семьи A даже по прямому пути',
    (select count(*) from storage.objects) = 0);
end;
$$;


-- ============================================================================

reset role;

\echo ''
\echo '════════════════════════════════════════════════════════════════'
\echo '  ВСЕ ТЕСТЫ ПРОЙДЕНЫ'
\echo '════════════════════════════════════════════════════════════════'
\echo ''
