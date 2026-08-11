-- ============================================================================
-- 0006_energy.sql — фаза 3, энергия (docs/03-energy.md)
--
-- Таблицы energy_profiles, tariffs, meters и meter_readings уже созданы в
-- 0001_schema.sql, а политики на них — в 0002_rls.sql типовым циклом. Здесь
-- только то, чего не хватало для работы: тариф по умолчанию у новой семьи и
-- расход по счётчику для сверки с расчётом.
-- ============================================================================

-- ─── Тариф по умолчанию ─────────────────────────────────────────────────────
--
-- Без него экран «Энергия» показывал бы киловатты и прочерк вместо гривен —
-- то есть ровно то, ради чего фаза и делалась, не работало бы до первого
-- захода в настройки.
--
-- Ставка на 2026 год, зафиксирована постановлением до 31 октября 2026.
-- Тариф редактируемый, а история пишется через effective_from/effective_to,
-- поэтому устаревание значения приложение переживёт: старые месяцы
-- продолжат считаться по старой цене.

create or replace function public.default_tariff_rate()
returns numeric
language sql
immutable
as $$ select 4.32::numeric $$;

comment on function public.default_tariff_rate() is
  'Базовый тариф населения, грн/кВт·ч. Отдельной функцией, чтобы менять '
  'его в одном месте, а не искать по вставкам.';

create or replace function public.ensure_default_tariff(hid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  -- Тариф уже заводили — второй не нужен: действующим может быть только один
  select id into tid
  from public.tariffs
  where household_id = hid and effective_to is null
  limit 1;

  if tid is not null then
    return tid;
  end if;

  insert into public.tariffs (household_id, name, kind, rate_day, currency)
  values (hid, 'Базовый', 'single', public.default_tariff_rate(), 'UAH')
  returning id into tid;

  return tid;
end;
$$;

revoke execute on function public.ensure_default_tariff(uuid) from public;
grant  execute on function public.ensure_default_tariff(uuid) to authenticated;


-- Новая семья получает тариф сразу. Через create_household, а не триггером на
-- households: триггер сработал бы и на служебных вставках, а тут одно место,
-- где семья заводится по-настоящему.
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

  perform public.ensure_default_tariff(hid);

  return hid;
end;
$$;


-- ─── Расход по счётчику ─────────────────────────────────────────────────────
--
-- Счётчик показывает нарастающий итог, а сравнивать с расчётом надо расход за
-- период. Разница берётся между двумя соседними показаниями и приводится к
-- месяцу: снимают показания когда придётся, а не первого числа.
--
-- Возвращает null, если показаний меньше двух — это не ошибка, а «сверять
-- пока не с чем», и интерфейс так и скажет.

create or replace function public.meter_monthly_usage(p_meter_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with ordered as (
    select
      read_at,
      coalesce(value_day, 0) + coalesce(value_night, 0) as total
    from public.meter_readings
    where meter_id = p_meter_id
      and public.is_household_member(household_id)
    order by read_at desc
    limit 2
  ),
  pair as (
    select
      max(total)  filter (where rn = 1) as newer,
      max(total)  filter (where rn = 2) as older,
      max(read_at) filter (where rn = 1) as newer_at,
      max(read_at) filter (where rn = 2) as older_at
    from (select *, row_number() over (order by read_at desc) as rn from ordered) t
  )
  select case
    -- Меньше двух показаний, либо оба в один день: делить не на что
    when older is null or newer_at = older_at then null
    -- Счётчик не может идти назад: значит его заменили или ошиблись при вводе
    when newer < older then null
    else (newer - older) / (newer_at - older_at)::numeric * 30.44
  end
  from pair;
$$;

comment on function public.meter_monthly_usage(uuid) is
  'Расход по счётчику, приведённый к месяцу (кВт·ч/мес). null — показаний '
  'меньше двух, либо они противоречивы.';

revoke execute on function public.meter_monthly_usage(uuid) from public;
grant  execute on function public.meter_monthly_usage(uuid) to authenticated;


-- ─── Индексы ────────────────────────────────────────────────────────────────

-- Показания всегда читаются по счётчику и в порядке дат
create index if not exists meter_readings_meter_date_idx
  on public.meter_readings (meter_id, read_at desc);

-- Действующий тариф ищется по household_id + effective_to is null
create index if not exists tariffs_active_idx
  on public.tariffs (household_id, effective_from desc);
