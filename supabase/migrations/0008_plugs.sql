-- ============================================================================
-- Умные розетки с замером мощности (Tapo P110 и совместимые)
--
-- Зачем это здесь. Весь экран «Энергия» до сих пор строился на *оценке*:
-- мощность из справочника, часы работы на глаз, отсюда честное «≈» у каждой
-- цифры (docs/03-energy.md). Розетка с ваттметром закрывает ровно ту дыру,
-- которую оценка закрыть не может — она говорит, сколько вещь съела на самом
-- деле. Поэтому замер здесь не «ещё один источник данных», а то, что
-- **отменяет** оценку для конкретной вещи: сверять расчёт с фактом теперь
-- можно не по всей квартире, а по каждому прибору отдельно.
--
-- Почему браузер не ходит в розетку сам. Розетка живёт в локальной сети,
-- отвечает по http и без CORS-заголовков. Страница на https такой запрос не
-- сделает никогда — это не обходится, это устройство своей архитектурой не
-- предназначено для браузера. Поэтому опрашивает её отдельная программа в той
-- же сети (tools/tapo-bridge), а сюда шлёт готовые замеры.
-- ============================================================================


-- ─── Розетка ────────────────────────────────────────────────────────────────

create table public.smart_plugs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  -- Какую вещь меряет. Не обязательна: розетку заводит мост, как только её
  -- увидел, а привязывает к вещи уже человек в приложении
  item_id       uuid references public.items(id) on delete set null,
  kind          text not null default 'tapo_p110',
  name          text,
  -- Идентификатор от самого устройства: по нему мост находит свою запись,
  -- не заводя дубль при каждом перезапуске
  device_id     text not null,

  -- «Сейчас»: перезаписывается на каждый опрос и потому не растит таблицу.
  -- История лежит отдельно, в plug_readings
  last_power_w  numeric,
  last_seen_at  timestamptz,
  today_wh      numeric,
  month_wh      numeric,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint smart_plugs_device_uniq unique (household_id, device_id)
);

create index smart_plugs_household_idx on public.smart_plugs (household_id)
  where deleted_at is null;
create index smart_plugs_item_idx on public.smart_plugs (item_id)
  where deleted_at is null;


-- ─── История замеров ────────────────────────────────────────────────────────
--
-- Мост опрашивает розетку раз в несколько секунд, но строку сюда кладём не на
-- каждый опрос: 17 тысяч строк в сутки на розетку — это способ упереться в
-- лимиты за месяц и ничего за это не получить. Частоту прореживает
-- plug-ingest, здесь лежит уже разрежённый ряд.

create table public.plug_readings (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plug_id      uuid not null references public.smart_plugs(id) on delete cascade,
  measured_at  timestamptz not null default now(),
  -- Мгновенная мощность, Вт. Приводит к ваттам мост: розетка отдаёт милливатты
  power_w      numeric,
  -- Счётчик самой розетки с начала суток, Вт·ч. Он сбрасывается в полночь,
  -- поэтому расход за день — это максимум за день, а не сумма
  today_wh     numeric,
  created_at   timestamptz not null default now()
);

create index plug_readings_plug_time_idx
  on public.plug_readings (plug_id, measured_at desc);


-- ─── Ключи для моста ────────────────────────────────────────────────────────
--
-- Мост — не человек, аккаунта у него нет и быть не должно: он крутится на
-- Raspberry Pi, откуда утечь может что угодно. Поэтому у него отдельный
-- отзываемый ключ, а не пароль хозяина.
--
-- Хранится хеш, а не сам ключ — по той же причине, по которой нигде не хранят
-- пароли: чтение таблицы не должно давать доступ. Сам ключ показывается
-- человеку ровно один раз, в момент создания.

create table public.plug_tokens (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash   text not null unique,
  name         text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index plug_tokens_household_idx on public.plug_tokens (household_id);


-- ─── updated_at ─────────────────────────────────────────────────────────────
--
-- В 0001 триггеры навешивал цикл по всем таблицам с updated_at. Он отработал
-- тогда и новых таблиц не увидит, поэтому здесь вешаем руками.

create trigger trg_smart_plugs_updated_at
  before update on public.smart_plugs
  for each row execute function public.set_updated_at();


-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.smart_plugs  enable row level security;
alter table public.plug_readings enable row level security;
alter table public.plug_tokens   enable row level security;

create policy smart_plugs_select on public.smart_plugs
  for select using (public.is_household_member(household_id));

create policy smart_plugs_modify on public.smart_plugs
  for all using (public.can_write(household_id))
          with check (public.can_write(household_id));

-- Замеры клиент только читает: пишет их мост через plug-ingest под служебной
-- ролью. Дать клиенту insert значило бы разрешить рисовать себе расход
create policy plug_readings_select on public.plug_readings
  for select using (public.is_household_member(household_id));

-- Ключ — это доступ на запись в дом, поэтому распоряжаться им может только
-- владелец или админ, а не любой участник
create policy plug_tokens_select on public.plug_tokens
  for select using (public.has_household_role(household_id, array['owner', 'admin']));

create policy plug_tokens_modify on public.plug_tokens
  for all using (public.has_household_role(household_id, array['owner', 'admin']))
          with check (public.has_household_role(household_id, array['owner', 'admin']));


-- ─── Права ──────────────────────────────────────────────────────────────────
--
-- Общий grant из 0002 раздали «всем таблицам схемы» на тот момент — новые
-- таблицы под него не попадают, поэтому здесь явно (как в 0005).
--
-- Права выданы по минимуму, а не «на всякий случай». Розетку клиент только
-- привязывает и переименовывает, заводит её мост; замеры он не пишет вовсе —
-- иначе любой участник мог бы нарисовать себе расход, и вся ценность замера
-- как факта пропала бы. Запрет держится сразу на двух уровнях: политики на
-- insert нет, и права на insert тоже нет.

grant select, update         on public.smart_plugs  to authenticated;
grant select                 on public.plug_readings to authenticated;
grant select, insert, update on public.plug_tokens  to authenticated;


-- ─── Расход по дням ─────────────────────────────────────────────────────────
--
-- Считает база, а не телефон: строки лежат здесь, и тащить две недели замеров
-- на телефон ради группировки незачем (та же причина, что у
-- meter_monthly_usage в 0006).
--
-- today_wh — счётчик с начала суток, обнуляемый в полночь. Значит расход за
-- день это максимум за день, а не сумма: сумма насчитала бы кратно больше.
--
-- Сутки считаем по местному времени, а не по UTC. В UTC граница суток
-- приходится на 02:00–03:00 по Киеву, и вечерний расход уезжал бы в
-- следующий день. Часовой пояс параметром — чтобы не зашивать географию в
-- запрос намертво.

create or replace function public.plug_daily_energy(
  p_plug_id uuid,
  p_days    int  default 14,
  p_tz      text default 'Europe/Kyiv'
)
returns table (day date, wh numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    (measured_at at time zone p_tz)::date as day,
    max(today_wh)                         as wh
  from public.plug_readings
  where plug_id = p_plug_id
    and today_wh is not null
    and public.is_household_member(household_id)
    and measured_at >= now() - make_interval(days => p_days)
  group by 1
  order by 1;
$$;

comment on function public.plug_daily_energy(uuid, int, text) is
  'Расход розетки по дням, Вт·ч. Пусто — замеров нет либо розетка чужая.';

revoke execute on function public.plug_daily_energy(uuid, int, text) from public;
grant  execute on function public.plug_daily_energy(uuid, int, text) to authenticated;


-- ─── Чистка истории ─────────────────────────────────────────────────────────
--
-- Замеры нужны для графика за последние недели, а не вечно. Без чистки
-- таблица растёт линейно и навсегда — при замере раз в пять минут это ~105
-- тысяч строк в год на розетку.

create or replace function public.prune_plug_readings(
  p_older_than interval default '90 days'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  delete from public.plug_readings where measured_at < now() - p_older_than;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.prune_plug_readings(interval) from public;


-- ─── Расписание ─────────────────────────────────────────────────────────────
--
-- Как и в 0005: pg_cron есть в Supabase, но нет в обычном Postgres, на котором
-- гоняются тесты. Поэтому расписание создаётся, только если расширение
-- доступно, а иначе миграция просто идёт дальше.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    perform cron.schedule(
      'domovoy-prune-plug-readings',
      '30 4 * * *',
      $cron$ select public.prune_plug_readings() $cron$
    );
  else
    raise notice 'pg_cron недоступен — чистка замеров не запланирована (норма для локального прогона)';
  end if;
end;
$$;
