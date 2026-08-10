# 02. Модель данных

Postgres в Supabase. Целевой файл миграции — `supabase/migrations/0001_init.sql`.

## Принципы

**1. Всё nullable, кроме `items.name`, идентификаторов и `household_id`.**
Продукт построен на том, что человек заполняет данные постепенно. База не
должна этому мешать: единственное обязательное поле у вещи — название.

**2. `household_id` денормализован в каждую таблицу.** Можно было бы выводить
принадлежность к семье через цепочку `item → space → home → household`, но
тогда каждая RLS-политика содержала бы JOIN-ы и выполнялась на каждой строке.
Плоское поле делает все политики одинаковыми и быстрыми. Консистентность
держит триггер (см. ниже).

**3. UUID генерирует клиент.** `default gen_random_uuid()` есть, но клиент
присылает свой идентификатор. Без этого офлайн-создание не идемпотентно:
повторная отправка из очереди создала бы дубль. С клиентским UUID повтор —
это `upsert` в ту же строку.

**4. Мягкое удаление.** `deleted_at` вместо `DELETE`. Нужно и для корзины на
30 дней, и для синхронизации: клиент должен узнать, что строка исчезла.

**5. Аудит везде.** `created_by`, `created_at`, `updated_at`. `updated_at`
обновляется триггером и служит опорой для разрешения конфликтов
(last-write-wins).

---

## Расширения и общие функции

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- pgvector, для §08-ai
create extension if not exists "pg_cron";    -- ежедневные напоминания

-- Единый триггер обновления updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

Триггер вешается на каждую таблицу:

```sql
create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();
```

---

## Пользователи и семьи

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  locale       text default 'ru',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

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
               check (role in ('owner','admin','member','guest')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index on public.household_members (user_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code         text not null unique,
  role         text not null default 'member'
               check (role in ('admin','member','guest')),
  expires_at   timestamptz,
  max_uses     int default 1,
  used_count   int not null default 0,
  created_by   uuid references auth.users(id),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
```

**Приглашения принимаются Edge Function `accept-invite` под service role.**
Обычная вставка в `household_members` невозможна: пользователь ещё не член
семьи, а RLS требует, чтобы он им уже был. Функция проверяет код, срок и
лимит использований, затем добавляет участника.

---

## Дом и пространства

```sql
create table public.homes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text,
  kind         text check (kind in ('apartment','house','dacha','garage','office','other')),
  address      text,
  area_m2      numeric,
  floor        int,
  notes        text,
  sort_order   int default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table public.spaces (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  parent_id    uuid references public.spaces(id) on delete cascade,
  name         text,
  kind         text,          -- kitchen | bath | bedroom | living | balcony |
                              -- hallway | storage | garage | other
  icon         text,
  color        text,
  photo_path   text,
  area_m2      numeric,
  notes        text,
  sort_order   int default 0,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index on public.spaces (home_id) where deleted_at is null;
create index on public.spaces (parent_id);
```

`parent_id` даёт вложенные зоны («Кухня → Шкаф под мойкой»). Глубже двух
уровней в интерфейсе не предлагаем; ограничение держит триггер:

```sql
create or replace function public.check_space_depth()
returns trigger language plpgsql as $$
declare
  parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'Пространство не может быть родителем самому себе';
  end if;
  select parent_id into parent_parent from public.spaces where id = new.parent_id;
  if parent_parent is not null then
    raise exception 'Глубина вложенности пространств ограничена двумя уровнями';
  end if;
  return new;
end;
$$;

create trigger trg_spaces_depth
  before insert or update on public.spaces
  for each row execute function public.check_space_depth();
```

---

## Справочник категорий

Системная таблица, наполняется из `data/categories.ru.json`. Не привязана к
семье и доступна на чтение всем аутентифицированным.

```sql
create table public.item_categories (
  id                       text primary key,     -- 'kitchen.fridge'
  parent_id                text references public.item_categories(id),
  name_ru                  text not null,
  icon                     text,
  sort_order               int default 0,

  -- значения по умолчанию для энергорасчёта (см. 03-energy.md)
  default_energy_mode      text check (default_energy_mode in
                             ('typical','label','power_hours','per_cycle')),
  default_power_w          numeric,
  default_standby_w        numeric,
  default_duty_cycle       numeric,
  default_hours_per_day    numeric,
  default_kwh_per_cycle    numeric,
  default_cycles_per_week  numeric,
  label_unit               text check (label_unit in
                             ('kwh_year','kwh_100cycles','kwh_1000h')),

  -- значения по умолчанию для гарантий и обслуживания
  default_warranty_months      int,
  default_service_interval_days int
);
```

`label_unit` критичен: после реформы энергетических наклеек ЕС (март 2021)
единица зависит от категории — холодильник маркируется кВт·ч в год, стиральная
машина кВт·ч на 100 циклов, телевизор кВт·ч на 1000 часов. Подробности в
[03-energy.md](03-energy.md).

---

## Вещи

```sql
create table public.items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  home_id       uuid references public.homes(id) on delete set null,
  space_id      uuid references public.spaces(id) on delete set null,
  category_id   text references public.item_categories(id),

  name          text not null,          -- единственное обязательное поле

  brand         text,
  model         text,
  serial_number text,

  purchased_at  date,
  price         numeric,
  currency      text default 'UAH',
  seller        text,

  warranty_months int,
  warranty_until  date,     -- если задано вручную, побеждает над расчётным

  condition     text,
  status        text default 'active'
                check (status in ('active','broken','sold','disposed','stored')),

  photo_path    text,
  notes         text,

  qr_slug       text unique,          -- короткий код для наклейки
  guest_visible boolean not null default false,

  sort_order    int default 0,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index on public.items (household_id) where deleted_at is null;
create index on public.items (space_id)     where deleted_at is null;
create index on public.items (warranty_until) where deleted_at is null;
```

### Полнотекстовый поиск

```sql
alter table public.items add column search_vector tsvector
  generated always as (
    to_tsvector('russian',
      coalesce(name,'')   || ' ' ||
      coalesce(brand,'')  || ' ' ||
      coalesce(model,'')  || ' ' ||
      coalesce(serial_number,'') || ' ' ||
      coalesce(notes,'')
    )
  ) stored;

create index on public.items using gin (search_vector);
```

### Произвольные поля

Чтобы схема не становилась потолком: кому-то важен код от сейфа, кому-то —
диаметр фильтра.

```sql
create table public.item_fields (
  id         uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  key        text,
  label      text,
  value      text,
  value_type text default 'text'
             check (value_type in ('text','number','date','url','bool')),
  sort_order int default 0
);
```

---

## Документы

```sql
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid references public.items(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete cascade,

  kind         text check (kind in
                 ('manual','receipt','warranty','photo','contract','other')),
  title        text,
  storage_path text,        -- путь в бакете docs
  external_url text,        -- альтернатива загрузке: ссылка на сайт производителя
  mime_type    text,
  size_bytes   bigint,
  page_count   int,

  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
```

**Storage.** Приватный бакет `docs`, путь строго
`{household_id}/{item_id}/{uuid}.{ext}` — первый сегмент пути используется в
политике доступа. Отдача через signed URL с коротким временем жизни.

---

## Сервис и контакты

```sql
create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text,
  role         text,        -- «мастер по стиралкам», «сервис Bosch»
  phone        text,
  email        text,
  url          text,
  notes        text,
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
  kind         text check (kind in ('repair','maintenance','install','inspection')),
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
```

---

## Задачи и расходники

```sql
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id      uuid references public.items(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete cascade,

  title        text,
  description  text,
  due_at       timestamptz,
  interval_days int,        -- если задано, задача повторяется
  assignee_id  uuid references auth.users(id),
  status       text default 'open' check (status in ('open','done','skipped')),
  source       text default 'manual'
               check (source in ('manual','warranty','maintenance','consumable')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),

  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index on public.tasks (household_id, status, due_at) where deleted_at is null;

create table public.consumables (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  item_id           uuid references public.items(id) on delete cascade,
  name              text,
  part_number       text,
  interval_days     int,
  last_replaced_at  date,
  next_due_at       date,
  qty_in_stock      int,
  shop_url          text,
  price             numeric,
  currency          text default 'UAH',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
```

Ежедневная задача `pg_cron` находит истекающие гарантии, наступившие
интервалы ТО и подошедшие сроки замены расходников, создаёт из них строки в
`tasks` (`source` показывает происхождение) и ставит пуш-уведомления в очередь.

---

## Энергия

```sql
create table public.energy_profiles (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  item_id         uuid not null unique references public.items(id) on delete cascade,

  mode            text not null default 'typical'
                  check (mode in ('typical','label','power_hours','per_cycle')),

  power_w         numeric,
  standby_w       numeric,
  duty_cycle      numeric check (duty_cycle between 0 and 1),
  hours_per_day   numeric check (hours_per_day between 0 and 24),
  days_per_week   int     check (days_per_week between 0 and 7),

  kwh_per_cycle   numeric,
  cycles_per_week numeric,

  label_value     numeric,    -- число с наклейки
  label_unit      text check (label_unit in
                    ('kwh_year','kwh_100cycles','kwh_1000h')),

  night_share     numeric check (night_share between 0 and 1),
  seasonality     jsonb,      -- {"1":1.4, "7":0.6} — коэффициенты по месяцам

  source          text,       -- 'user' | 'category_default' | 'ai_nameplate'
  confidence      text check (confidence in ('low','medium','high')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.tariffs (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  name           text,
  kind           text not null default 'single' check (kind in ('single','two_zone')),
  rate_day       numeric,
  rate_night     numeric,
  night_start    time default '23:00',
  night_end      time default '07:00',
  standing_charge numeric,
  currency       text default 'UAH',
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.meters (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  home_id      uuid references public.homes(id) on delete cascade,
  kind         text check (kind in ('electricity','water_cold','water_hot','gas','heat')),
  serial       text,
  zones        int default 1,
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

create index on public.meter_readings (meter_id, read_at desc);
```

Расчёт потребления **не хранится в базе** — он детерминированно выводится на
клиенте из `energy_profiles` и действующего `tariffs`. Хранить нужно только
исходные данные и показания счётчика; иначе при изменении тарифа пришлось бы
пересчитывать историю.

---

## Лента изменений

```sql
create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id     uuid references auth.users(id),
  entity_type  text,
  entity_id    uuid,
  action       text check (action in ('create','update','delete','restore')),
  diff         jsonb,
  created_at   timestamptz not null default now()
);

create index on public.activity (household_id, created_at desc);
```

---

## Таблицы ИИ-слоя

Подробности — в [08-ai.md](08-ai.md).

```sql
create table public.ai_settings (
  household_id     uuid primary key references public.households(id) on delete cascade,
  enabled          boolean not null default false,
  monthly_limit_usd numeric default 5,
  consent_at       timestamptz,
  consent_by       uuid references auth.users(id)
);

create table public.ai_usage (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id),
  feature      text,
  model        text,
  tokens_in    int,
  tokens_out   int,
  cost_usd     numeric,
  created_at   timestamptz not null default now()
);

create index on public.ai_usage (household_id, created_at desc);

create table public.ai_cache (
  input_hash text primary key,
  feature    text,
  model      text,
  result     jsonb,
  created_at timestamptz not null default now()
);

create table public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page        int,
  content     text,
  embedding   vector(1536)
);

create index on public.document_chunks
  using hnsw (embedding vector_cosine_ops);
```

---

## Row Level Security

RLS — единственный механизм авторизации в этом приложении. Клиент ходит в базу
напрямую, поэтому ошибка в политике равна утечке данных всех семей.

### Вспомогательные функции

**Ключевая деталь:** политика на `household_members`, которая сама читает
`household_members`, вызывает **бесконечную рекурсию**. Postgres применит
политику к запросу внутри политики. Обходится функцией с `security definer` —
она выполняется с правами владельца и RLS обходит:

```sql
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
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
    select 1 from public.household_members m
    where m.household_id = hid
      and m.user_id = auth.uid()
      and m.role = any(roles)
  );
$$;

revoke execute on function public.is_household_member(uuid) from public;
revoke execute on function public.has_household_role(uuid, text[]) from public;
grant  execute on function public.is_household_member(uuid) to authenticated;
grant  execute on function public.has_household_role(uuid, text[]) to authenticated;
```

`set search_path = public` обязателен: без него функция с `security definer`
уязвима к подмене схемы.

### Типовая пара политик

Применяется ко всем таблицам с `household_id` — `homes`, `spaces`,
`item_fields`, `documents`, `contacts`, `service_records`, `tasks`,
`consumables`, `energy_profiles`, `tariffs`, `meters`, `meter_readings`,
`ai_usage`, `document_chunks`:

```sql
alter table public.tasks enable row level security;

create policy tasks_select on public.tasks
  for select
  using (is_household_member(household_id));

create policy tasks_modify on public.tasks
  for all
  using      (has_household_role(household_id, array['owner','admin','member']))
  with check (has_household_role(household_id, array['owner','admin','member']));
```

Роль `guest` попадает под `is_household_member`, поэтому читает, но не пишет.

### Вещи: режим арендатора

Гость видит только то, что для него открыли:

```sql
alter table public.items enable row level security;

create policy items_select on public.items
  for select
  using (
    has_household_role(household_id, array['owner','admin','member'])
    or (is_household_member(household_id) and guest_visible)
  );

create policy items_modify on public.items
  for all
  using      (has_household_role(household_id, array['owner','admin','member']))
  with check (has_household_role(household_id, array['owner','admin','member']));
```

### Семьи и участники

```sql
alter table public.households enable row level security;

create policy households_select on public.households
  for select using (is_household_member(id));

create policy households_update on public.households
  for update using (has_household_role(id, array['owner','admin']))
  with check      (has_household_role(id, array['owner','admin']));

create policy households_insert on public.households
  for insert with check (created_by = auth.uid());

alter table public.household_members enable row level security;

-- Читаем состав своей семьи. Рекурсии нет: функция security definer.
create policy members_select on public.household_members
  for select using (is_household_member(household_id));

-- Менять состав может только владелец или админ
create policy members_modify on public.household_members
  for all
  using      (has_household_role(household_id, array['owner','admin']))
  with check (has_household_role(household_id, array['owner','admin']));
```

Создание семьи — двухшаговая операция (вставить `households`, затем себя в
`household_members`), поэтому её выполняет RPC-функция `create_household(name)`
с `security definer`, чтобы обе вставки прошли атомарно.

### Профили

```sql
alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- Плюс: видим профили тех, с кем состоим в одной семье
create policy profiles_select_family on public.profiles
  for select using (
    exists (
      select 1
      from public.household_members me
      join public.household_members them using (household_id)
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
```

### Справочник категорий

```sql
alter table public.item_categories enable row level security;

create policy categories_read on public.item_categories
  for select to authenticated using (true);
-- записи нет: справочник наполняется миграцией
```

### Storage

```sql
create policy docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'docs'
    and is_household_member(((storage.foldername(name))[1])::uuid)
  );

create policy docs_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'docs'
    and has_household_role(((storage.foldername(name))[1])::uuid,
                           array['owner','admin','member'])
  );
```

---

## Консистентность `household_id`

Денормализованное поле нужно защитить от подделки: клиент не должен иметь
возможности создать вещь с `household_id` своей семьи, но `space_id` из чужой.
Проверка — триггером:

```sql
create or replace function public.check_item_household()
returns trigger language plpgsql as $$
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
```

Аналогичные проверки — для `spaces` (родитель в той же семье), `documents`,
`tasks`, `service_records`.

---

## Что проверить тестами

- Пользователь из семьи A не видит ни одной строки семьи B — по каждой
  таблице отдельно.
- `guest` читает только `items` с `guest_visible = true` и не может писать.
- Политика на `household_members` не уходит в рекурсию.
- Вставка вещи с чужим `space_id` падает с ошибкой триггера.
- Файл в бакете `docs` недоступен пользователю из другой семьи даже по
  прямому пути.
- `updated_at` меняется при каждом `UPDATE`.
- Повторная вставка строки с тем же клиентским UUID не создаёт дубль.
