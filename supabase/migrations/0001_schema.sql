-- ============================================================================
-- 0001_schema.sql — базовая схема «Домового»
--
-- Реализует docs/02-data-model.md. Принципы:
--   1. Всё nullable, кроме items.name, идентификаторов и household_id
--   2. household_id денормализован во все таблицы — RLS без JOIN-ов
--   3. UUID генерирует клиент — офлайн-создание идемпотентно
--   4. Мягкое удаление через deleted_at
--   5. created_by / created_at / updated_at везде
--
-- Расширения vector и pg_cron здесь сознательно не подключаются: они нужны
-- фазам 2 и 4 и отсутствуют в обычном Postgres, а эта миграция должна
-- накатываться и на локальный кластер для прогона тестов RLS.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;   -- поиск по опечаткам в названиях

-- ─── Общий триггер updated_at ────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================================
-- Пользователи и семьи
-- ============================================================================

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  locale       text default 'ru',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Профиль заводится автоматически при регистрации
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member'
               check (role in ('owner', 'admin', 'member', 'guest')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members (user_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code         text not null unique,
  role         text not null default 'member'
               check (role in ('admin', 'member', 'guest')),
  expires_at   timestamptz,
  max_uses     int default 1,
  used_count   int not null default 0,
  created_by   uuid references auth.users(id),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index household_invites_household_idx on public.household_invites (household_id);


-- ============================================================================
-- Дом и пространства
-- ============================================================================

create table public.homes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text,
  kind         text check (kind in ('apartment', 'house', 'dacha', 'garage', 'office', 'other')),
  address      text,
  area_m2      numeric,
  floor        int,
  notes        text,
  sort_order   int not null default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index homes_household_idx on public.homes (household_id) where deleted_at is null;

create table public.spaces (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  parent_id    uuid references public.spaces(id) on delete cascade,
  name         text,
  kind         text,     -- kitchen | bath | bedroom | living | balcony |
                         -- hallway | storage | garage | other
  icon         text,
  color        text,
  photo_path   text,
  area_m2      numeric,
  notes        text,
  sort_order   int not null default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index spaces_home_idx   on public.spaces (home_id) where deleted_at is null;
create index spaces_parent_idx on public.spaces (parent_id);

-- Вложенность пространств ограничена двумя уровнями: «Кухня → Шкаф под мойкой».
-- Глубже интерфейс не предлагает, и база не должна позволять.
create or replace function public.check_space_depth()
returns trigger
language plpgsql
as $$
declare
  grandparent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Пространство не может быть родителем самому себе';
  end if;

  select parent_id into grandparent from public.spaces where id = new.parent_id;

  if grandparent is not null then
    raise exception 'Глубина вложенности пространств ограничена двумя уровнями';
  end if;

  return new;
end;
$$;

create trigger trg_spaces_depth
  before insert or update on public.spaces
  for each row execute function public.check_space_depth();


-- ============================================================================
-- Справочник категорий (системный, наполняется из data/categories.ru.json)
-- ============================================================================

create table public.item_categories (
  id         text primary key,                        -- 'kitchen.fridge'
  parent_id  text references public.item_categories(id),
  name_ru    text not null,
  icon       text,
  sort_order int not null default 0,

  -- значения по умолчанию для энергорасчёта (фаза 3, docs/03-energy.md)
  default_energy_mode     text check (default_energy_mode in
                            ('typical', 'label', 'power_hours', 'per_cycle')),
  default_power_w         numeric,
  default_standby_w       numeric,
  default_duty_cycle      numeric,
  default_hours_per_day   numeric,
  default_kwh_per_cycle   numeric,
  default_cycles_per_week numeric,
  label_unit              text check (label_unit in
                            ('kwh_year', 'kwh_100cycles', 'kwh_1000h')),

  -- значения по умолчанию для гарантий и обслуживания
  default_warranty_months       int,
  default_service_interval_days int
);


-- ============================================================================
-- Вещи
-- ============================================================================

create table public.items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  home_id       uuid references public.homes(id) on delete set null,
  space_id      uuid references public.spaces(id) on delete set null,
  category_id   text references public.item_categories(id) on delete set null,

  name          text not null,          -- единственное обязательное поле

  brand         text,
  model         text,
  serial_number text,

  purchased_at  date,
  price         numeric,
  currency      text default 'UAH',
  seller        text,

  warranty_months int,
  warranty_until  date,   -- задано вручную — побеждает над расчётным

  condition     text,
  status        text not null default 'active'
                check (status in ('active', 'broken', 'sold', 'disposed', 'stored')),

  photo_path    text,
  notes         text,

  qr_slug       text unique,            -- короткий код для наклейки
  guest_visible boolean not null default false,

  sort_order    int not null default 0,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint items_name_not_blank check (length(btrim(name)) > 0)
);

-- Полнотекстовый поиск. to_tsvector с литеральной конфигурацией immutable,
-- поэтому годится для generated-колонки.
alter table public.items
  add column search_vector tsvector
  generated always as (
    to_tsvector('russian',
      coalesce(name, '')          || ' ' ||
      coalesce(brand, '')         || ' ' ||
      coalesce(model, '')         || ' ' ||
      coalesce(serial_number, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored;

create index items_household_idx      on public.items (household_id) where deleted_at is null;
create index items_space_idx          on public.items (space_id)     where deleted_at is null;
create index items_warranty_idx       on public.items (warranty_until) where deleted_at is null;
create index items_search_idx         on public.items using gin (search_vector);
create index items_trgm_idx           on public.items using gin (name gin_trgm_ops);

create table public.item_fields (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid not null references public.items(id) on delete cascade,
  key          text,
  label        text,
  value        text,
  value_type   text not null default 'text'
               check (value_type in ('text', 'number', 'date', 'url', 'bool')),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index item_fields_item_idx on public.item_fields (item_id);


-- ============================================================================
-- Документы
-- ============================================================================

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid references public.items(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete cascade,

  kind         text check (kind in
                 ('manual', 'receipt', 'warranty', 'photo', 'contract', 'other')),
  title        text,
  storage_path text,      -- {household_id}/{item_id}/{uuid}.{ext} в бакете docs
  external_url text,      -- альтернатива загрузке: ссылка на сайт производителя
  mime_type    text,
  size_bytes   bigint,
  page_count   int,

  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index documents_item_idx      on public.documents (item_id)      where deleted_at is null;
create index documents_household_idx on public.documents (household_id) where deleted_at is null;


-- ============================================================================
-- Сервис и контакты
-- ============================================================================

create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text,
  role         text,       -- «мастер по стиралкам», «сервис Bosch»
  phone        text,
  email        text,
  url          text,
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table public.item_contacts (
  item_id    uuid not null references public.items(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  primary key (item_id, contact_id)
);

create table public.service_records (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid not null references public.items(id) on delete cascade,
  kind         text check (kind in ('repair', 'maintenance', 'install', 'inspection')),
  performed_at date,
  contact_id   uuid references public.contacts(id) on delete set null,
  cost         numeric,
  currency     text default 'UAH',
  description  text,
  next_due_at  date,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index service_records_item_idx on public.service_records (item_id) where deleted_at is null;


-- ============================================================================
-- Задачи и расходники (наполняются с фазы 2)
-- ============================================================================

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid references public.items(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete cascade,

  title        text,
  description  text,
  due_at       timestamptz,
  interval_days int,        -- задано → задача повторяется
  assignee_id  uuid references auth.users(id) on delete set null,
  status       text not null default 'open' check (status in ('open', 'done', 'skipped')),
  source       text not null default 'manual'
               check (source in ('manual', 'warranty', 'maintenance', 'consumable')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,

  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index tasks_due_idx on public.tasks (household_id, status, due_at) where deleted_at is null;

create table public.consumables (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  item_id          uuid references public.items(id) on delete cascade,
  name             text,
  part_number      text,
  interval_days    int,
  last_replaced_at date,
  next_due_at      date,
  qty_in_stock     int,
  shop_url         text,
  price            numeric,
  currency         text default 'UAH',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);


-- ============================================================================
-- Энергия (наполняется с фазы 3)
-- ============================================================================

create table public.energy_profiles (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  item_id         uuid not null unique references public.items(id) on delete cascade,

  mode            text not null default 'typical'
                  check (mode in ('typical', 'label', 'power_hours', 'per_cycle')),

  power_w         numeric,
  standby_w       numeric,
  duty_cycle      numeric check (duty_cycle between 0 and 1),
  hours_per_day   numeric check (hours_per_day between 0 and 24),
  days_per_week   int     check (days_per_week between 0 and 7),

  kwh_per_cycle   numeric,
  cycles_per_week numeric,

  label_value     numeric,
  label_unit      text check (label_unit in ('kwh_year', 'kwh_100cycles', 'kwh_1000h')),

  night_share     numeric check (night_share between 0 and 1),
  seasonality     jsonb,

  source          text check (source in ('user', 'category_default', 'ai_nameplate')),
  confidence      text check (confidence in ('low', 'medium', 'high')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.tariffs (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text,
  kind            text not null default 'single' check (kind in ('single', 'two_zone')),
  rate_day        numeric,
  rate_night      numeric,
  night_start     time default '23:00',
  night_end       time default '07:00',
  standing_charge numeric,
  currency        text default 'UAH',
  effective_from  date not null default current_date,
  effective_to    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.meters (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  kind         text check (kind in ('electricity', 'water_cold', 'water_hot', 'gas', 'heat')),
  serial       text,
  zones        int not null default 1,
  unit         text default 'kWh',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table public.meter_readings (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  meter_id     uuid not null references public.meters(id) on delete cascade,
  read_at      date not null default current_date,
  value_day    numeric,
  value_night  numeric,
  photo_path   text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index meter_readings_meter_idx on public.meter_readings (meter_id, read_at desc);


-- ============================================================================
-- Лента изменений
-- ============================================================================

create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  entity_type  text,
  entity_id    uuid,
  action       text check (action in ('create', 'update', 'delete', 'restore')),
  diff         jsonb,
  created_at   timestamptz not null default now()
);

create index activity_household_idx on public.activity (household_id, created_at desc);


-- ============================================================================
-- Настройки ИИ (наполняются с фазы 2, см. docs/08-ai.md)
-- ============================================================================

create table public.ai_settings (
  household_id      uuid primary key references public.households(id) on delete cascade,
  enabled           boolean not null default false,
  monthly_limit_usd numeric not null default 5,
  consent_at        timestamptz,
  consent_by        uuid references auth.users(id) on delete set null
);

create table public.ai_usage (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  feature      text,
  model        text,
  tokens_in    int,
  tokens_out   int,
  cost_usd     numeric,
  created_at   timestamptz not null default now()
);

create index ai_usage_household_idx on public.ai_usage (household_id, created_at desc);

create table public.ai_cache (
  input_hash varchar primary key,
  feature    text not null,
  model      text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);

create index ai_cache_feature_idx on public.ai_cache (feature, created_at desc);


-- ============================================================================
-- Консистентность денормализованного household_id
--
-- Клиент присылает household_id сам. Без проверки он мог бы создать вещь
-- со своим household_id, но space_id из чужой семьи.
-- ============================================================================

create or replace function public.check_item_household()
returns trigger
language plpgsql
as $$
begin
  if new.space_id is not null and not exists (
    select 1 from public.spaces s
    where s.id = new.space_id and s.household_id = new.household_id
  ) then
    raise exception 'space_id принадлежит другой семье';
  end if;

  if new.home_id is not null and not exists (
    select 1 from public.homes h
    where h.id = new.home_id and h.household_id = new.household_id
  ) then
    raise exception 'home_id принадлежит другой семье';
  end if;

  return new;
end;
$$;

create trigger trg_items_household
  before insert or update on public.items
  for each row execute function public.check_item_household();


create or replace function public.check_space_household()
returns trigger
language plpgsql
as $$
begin
  if new.home_id is not null and not exists (
    select 1 from public.homes h
    where h.id = new.home_id and h.household_id = new.household_id
  ) then
    raise exception 'home_id принадлежит другой семье';
  end if;

  if new.parent_id is not null and not exists (
    select 1 from public.spaces s
    where s.id = new.parent_id and s.household_id = new.household_id
  ) then
    raise exception 'parent_id принадлежит другой семье';
  end if;

  return new;
end;
$$;

create trigger trg_spaces_household
  before insert or update on public.spaces
  for each row execute function public.check_space_household();


-- Общая проверка «дочерняя запись из той же семьи, что и вещь»
create or replace function public.check_child_household()
returns trigger
language plpgsql
as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.items i
    where i.id = new.item_id and i.household_id = new.household_id
  ) then
    raise exception 'item_id принадлежит другой семье';
  end if;

  return new;
end;
$$;

create trigger trg_documents_household
  before insert or update on public.documents
  for each row execute function public.check_child_household();

create trigger trg_item_fields_household
  before insert or update on public.item_fields
  for each row execute function public.check_child_household();

create trigger trg_service_records_household
  before insert or update on public.service_records
  for each row execute function public.check_child_household();

create trigger trg_tasks_household
  before insert or update on public.tasks
  for each row execute function public.check_child_household();


-- ============================================================================
-- Триггеры updated_at на все таблицы, где эта колонка есть
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'updated_at'
  loop
    execute format(
      'create trigger trg_%1$s_updated_at
         before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
