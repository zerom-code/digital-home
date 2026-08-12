-- ============================================================================
-- phase4_plugs_test.sql — умные розетки: изоляция, права, расход по дням
--
-- Запускается после rls_test / phase2_test / phase3_test и переиспользует их
-- каркас (tests.ok / tests.uid / auth.login_as) и семьи A и B.
--
-- Роли из подготовки rls_test:
--   Алиса  1111… — владелец семьи A
--   Боб    2222… — участник семьи A
--   Кэрол  3333… — владелец семьи B
--   Дэйв   4444… — гость семьи A
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '── 15. розетки: заведение и изоляция ───────────────────────────'

reset role;

-- Розетки заводит мост под служебной ролью, поэтому здесь тоже без RLS
do $$
declare
  a_plug uuid;
  b_plug uuid;
begin
  insert into public.smart_plugs (household_id, device_id, name, last_power_w, last_seen_at, month_wh)
  values (tests.uid('a_household'), 'AA-DEVICE-1', 'Розетка A', 1800, now(), 12000)
  returning id into a_plug;

  insert into public.smart_plugs (household_id, device_id, name, last_power_w, last_seen_at, month_wh)
  values (tests.uid('b_household'), 'BB-DEVICE-1', 'Розетка B', 40, now(), 500)
  returning id into b_plug;

  perform tests.put('a_plug', a_plug::text);
  perform tests.put('b_plug', b_plug::text);
end;
$$;

-- Один и тот же device_id в одной семье — это та же самая розетка, а не вторая.
-- Без этого мост заводил бы дубль при каждом перезапуске
select tests.raises(
  'повторный device_id в семье не создаёт вторую розетку',
  $$insert into public.smart_plugs (household_id, device_id)
    values (tests.uid('a_household'), 'AA-DEVICE-1')$$
);

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  perform tests.ok('Алиса видит свою розетку',
    (select count(*) from public.smart_plugs
     where household_id = tests.uid('a_household')) = 1);

  perform tests.ok('розетка чужой семьи не видна',
    (select count(*) from public.smart_plugs
     where household_id = tests.uid('b_household')) = 0);
end;
$$;


\echo ''
\echo '── 16. замеры только читаются ──────────────────────────────────'

reset role;

-- Историю пишет plug-ingest под служебной ролью
do $$
declare pid uuid := tests.uid('a_plug');
begin
  insert into public.plug_readings (household_id, plug_id, measured_at, power_w, today_wh) values
    -- Счётчик розетки копится с начала суток и обнуляется в полночь, поэтому
    -- за день его надо брать максимумом, а не суммой
    (tests.uid('a_household'), pid, timestamptz '2026-03-05 08:00+02', 1800,  400),
    (tests.uid('a_household'), pid, timestamptz '2026-03-05 14:00+02', 1750,  900),
    (tests.uid('a_household'), pid, timestamptz '2026-03-05 20:00+02', 1700, 1500),
    -- 01:00 по Киеву — это уже следующие сутки, хотя в UTC ещё предыдущие.
    -- Если группировать по UTC, ночной расход уедет во вчера
    (tests.uid('a_household'), pid, timestamptz '2026-03-06 01:00+02',  120,   80);
end;
$$;

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  perform tests.ok('свои замеры видны',
    (select count(*) from public.plug_readings
     where plug_id = tests.uid('a_plug')) = 4);
end;
$$;

-- Ключевое: клиент не должен уметь дорисовывать себе расход. Политики на
-- insert для plug_readings нет вовсе — писать может только служебная роль
select tests.raises(
  'участник не может вписать замер сам',
  $$insert into public.plug_readings (household_id, plug_id, power_w)
    values (tests.uid('a_household'), tests.uid('a_plug'), 5)$$
);


\echo ''
\echo '── 17. расход по дням ──────────────────────────────────────────'

do $$
declare
  march5 numeric;
  march6 numeric;
  days   int;
begin
  select count(*) into days
  from public.plug_daily_energy(tests.uid('a_plug'), 36500);

  select wh into march5
  from public.plug_daily_energy(tests.uid('a_plug'), 36500) where day = date '2026-03-05';

  select wh into march6
  from public.plug_daily_energy(tests.uid('a_plug'), 36500) where day = date '2026-03-06';

  perform tests.ok('сутки разделились по местному времени, а не по UTC', days = 2);
  perform tests.ok('за день берётся максимум счётчика, а не сумма', march5 = 1500);
  perform tests.ok('ночной замер попал в свои сутки', march6 = 80);
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  -- Функция security definer, поэтому проверяем её отдельно на утечку:
  -- изнутри она обязана уважать членство, а не права владельца
  perform tests.ok('чужую розетку через функцию не прочитать',
    (select count(*) from public.plug_daily_energy(tests.uid('a_plug'), 36500)) = 0);
end;
$$;


\echo ''
\echo '── 18. ключи моста ─────────────────────────────────────────────'

reset role;

do $$
begin
  insert into public.plug_tokens (household_id, token_hash, name)
  values (tests.uid('a_household'), 'hash-of-a-token', 'Pi на кухне');
end;
$$;

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  perform tests.ok('владелец видит ключи своей семьи',
    (select count(*) from public.plug_tokens
     where household_id = tests.uid('a_household')) = 1);
end;
$$;

-- Ключ даёт право писать в дом, поэтому обычному участнику его знать незачем
do $$ begin perform auth.login_as('22222222-2222-2222-2222-222222222222'); end; $$;

do $$
begin
  perform tests.ok('обычный участник ключи не видит',
    (select count(*) from public.plug_tokens
     where household_id = tests.uid('a_household')) = 0);
end;
$$;

do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  perform tests.ok('чужая семья ключи не видит',
    (select count(*) from public.plug_tokens) = 0);
end;
$$;

-- Гость не пишет ничего, включая привязку розеток.
--
-- Здесь именно проверка на ноль строк, а не на ошибку: политика в USING
-- отфильтровывает строки, а не роняет запрос, поэтому UPDATE у гостя
-- проходит успешно и не задевает ничего. Ждать исключения значило бы
-- проверять не то, как ведёт себя RLS
do $$ begin perform auth.login_as('44444444-4444-4444-4444-444444444444'); end; $$;

do $$
declare affected int;
begin
  update public.smart_plugs set name = 'моя теперь'
  where household_id = tests.uid('a_household');
  get diagnostics affected = row_count;

  perform tests.ok('правка розетки гостем не задевает ни одной строки', affected = 0);
end;
$$;

do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
begin
  perform tests.ok('название розетки осталось прежним',
    (select name from public.smart_plugs where id = tests.uid('a_plug')) = 'Розетка A');
end;
$$;


\echo ''
\echo '── 19. чистка истории ──────────────────────────────────────────'

reset role;

-- Отдельная розетка и метки относительно now(): привязка к календарным датам
-- сделала бы тест таким, который однажды сам протухнет
do $$
declare
  prune_plug uuid;
  old_left    int;
  fresh_left  int;
begin
  insert into public.smart_plugs (household_id, device_id, name)
  values (tests.uid('a_household'), 'AA-DEVICE-PRUNE', 'Для чистки')
  returning id into prune_plug;

  insert into public.plug_readings (household_id, plug_id, measured_at, power_w, today_wh) values
    (tests.uid('a_household'), prune_plug, now() - interval '200 days', 10, 10),
    (tests.uid('a_household'), prune_plug, now() - interval '1 day',    20, 20);

  perform public.prune_plug_readings('90 days');

  select count(*) into old_left
  from public.plug_readings
  where plug_id = prune_plug and measured_at < now() - interval '90 days';

  select count(*) into fresh_left
  from public.plug_readings
  where plug_id = prune_plug and measured_at >= now() - interval '90 days';

  perform tests.ok('старые замеры удалены', old_left = 0);
  perform tests.ok('свежие замеры на месте', fresh_left = 1);
end;
$$;

reset role;
