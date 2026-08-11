-- ============================================================================
-- phase3_test.sql — энергия: тариф по умолчанию, изоляция, расход по счётчику
--
-- Запускается после rls_test.sql и phase2_test.sql, переиспользует их каркас
-- (tests.ok / tests.uid / auth.login_as) и созданные там семьи A и B.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '── 12. тариф по умолчанию ──────────────────────────────────────'

reset role;

-- Семьи A и B заводились до появления 0006, поэтому тариф им ставим тем же
-- вызовом, каким его получают новые: заодно это и проверка функции
do $$
begin
  perform public.ensure_default_tariff(tests.uid('a_household'));
  perform public.ensure_default_tariff(tests.uid('b_household'));
end;
$$;

do $$
declare rate numeric;
begin
  select rate_day into rate
  from public.tariffs
  where household_id = tests.uid('a_household') and effective_to is null;

  perform tests.ok('у новой семьи сразу есть действующий тариф', rate is not null);
  perform tests.ok('ставка — базовый тариф населения', rate = 4.32);
end;
$$;

do $$
declare before_count int; after_count int;
begin
  select count(*) into before_count
  from public.tariffs where household_id = tests.uid('a_household');

  -- Ключевое свойство: функция идемпотентна. Иначе каждый заход в приложение
  -- плодил бы «действующие» тарифы, и расчёт зависел бы от того, какой из них
  -- попадётся первым
  perform public.ensure_default_tariff(tests.uid('a_household'));

  select count(*) into after_count
  from public.tariffs where household_id = tests.uid('a_household');

  perform tests.ok('второй тариф не создаётся', before_count = after_count);
end;
$$;

\echo ''
\echo '── 13. изоляция энергоданных между семьями ─────────────────────'

set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare visible int;
begin
  select count(*) into visible from public.tariffs;
  perform tests.ok('участник A видит только свой тариф', visible = 1);

  select count(*) into visible
  from public.tariffs where household_id = tests.uid('b_household');
  perform tests.ok('тариф семьи B недоступен', visible = 0);
end;
$$;

-- Энергопрофиль вещи
do $$
declare new_id uuid;
begin
  insert into public.energy_profiles
    (household_id, item_id, mode, power_w, duty_cycle, source, confidence)
  values (tests.uid('a_household'), tests.uid('a_fridge'), 'typical', 150, 0.3,
          'category_default', 'medium')
  returning id into new_id;
  perform tests.put('a_profile', new_id::text);
end;
$$;

reset role;
set role authenticated;
do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
declare visible int;
begin
  select count(*) into visible from public.energy_profiles;
  perform tests.ok('чужой энергопрофиль не виден чужой семье', visible = 0);
end;
$$;

do $$
declare affected int;
begin
  update public.energy_profiles set power_w = 9999
  where id = tests.uid('a_profile');
  get diagnostics affected = row_count;
  perform tests.ok('чужой энергопрофиль не переписать', affected = 0);
end;
$$;

\echo ''
\echo '── 14. расход по счётчику ──────────────────────────────────────'

reset role;
set role authenticated;
do $$ begin perform auth.login_as('11111111-1111-1111-1111-111111111111'); end; $$;

do $$
declare new_id uuid;
begin
  insert into public.meters (household_id, kind, zones, unit)
  values (tests.uid('a_household'), 'electricity', 1, 'kWh')
  returning id into new_id;
  perform tests.put('a_meter', new_id::text);
end;
$$;

do $$
begin
  perform tests.ok('без показаний сверять не с чем',
                   public.meter_monthly_usage(tests.uid('a_meter')) is null);
end;
$$;

do $$
begin
  insert into public.meter_readings (household_id, meter_id, read_at, value_day)
  values (tests.uid('a_household'), tests.uid('a_meter'), current_date - 30, 1000);

  perform tests.ok('одного показания тоже мало',
                   public.meter_monthly_usage(tests.uid('a_meter')) is null);
end;
$$;

do $$
declare usage numeric;
begin
  -- 300 кВт·ч ровно за 30 дней. Месяц длиннее (30.44), поэтому и расход в
  -- пересчёте на месяц чуть больше — это не погрешность, а разные периоды
  insert into public.meter_readings (household_id, meter_id, read_at, value_day)
  values (tests.uid('a_household'), tests.uid('a_meter'), current_date, 1300);

  usage := public.meter_monthly_usage(tests.uid('a_meter'));
  perform tests.ok('расход приведён к месяцу',
                   round(usage, 1) = round(300::numeric / 30 * 30.44, 1));
end;
$$;

do $$
declare usage numeric;
begin
  -- Счётчик заменили: показания пошли с нуля. Считать «минус тысяча» нельзя,
  -- честнее не показывать ничего
  insert into public.meter_readings (household_id, meter_id, read_at, value_day)
  values (tests.uid('a_household'), tests.uid('a_meter'), current_date + 1, 5);

  usage := public.meter_monthly_usage(tests.uid('a_meter'));
  perform tests.ok('показания назад не считаются расходом', usage is null);
end;
$$;

do $$
declare usage numeric;
begin
  -- Двузонный счётчик: расход — сумма обеих зон
  delete from public.meter_readings where meter_id = tests.uid('a_meter');

  insert into public.meter_readings (household_id, meter_id, read_at, value_day, value_night)
  values (tests.uid('a_household'), tests.uid('a_meter'), current_date - 30, 1000, 500),
         (tests.uid('a_household'), tests.uid('a_meter'), current_date,      1200, 600);

  usage := public.meter_monthly_usage(tests.uid('a_meter'));
  perform tests.ok('обе зоны складываются',
                   round(usage, 1) = round(300::numeric / 30 * 30.44, 1));
end;
$$;

reset role;
set role authenticated;
do $$ begin perform auth.login_as('33333333-3333-3333-3333-333333333333'); end; $$;

do $$
begin
  -- Функция security definer, поэтому её отдельно проверяем на утечку:
  -- изнутри она обязана уважать членство, а не права владельца
  perform tests.ok('чужой счётчик через функцию не прочитать',
                   public.meter_monthly_usage(tests.uid('a_meter')) is null);
end;
$$;

reset role;
