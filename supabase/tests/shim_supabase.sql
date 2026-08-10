-- ============================================================================
-- shim_supabase.sql — минимальная эмуляция Supabase для локального Postgres
--
-- В облаке схемы auth и storage создаёт сама платформа. Чтобы прогнать
-- миграции и тесты RLS на обычном кластере, воспроизводим ровно то, на что
-- опираются политики:
--
--   auth.users        — таблица, на которую ссылаются внешние ключи
--   auth.uid()        — читает sub из JWT-клеймов в GUC, как в Supabase
--   роли              — anon / authenticated / service_role
--   storage.*         — buckets, objects, foldername()
--
-- Этот файл НЕ является частью миграций и в облако не едет.
-- ============================================================================

-- ─── Роли ───────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;


-- ─── Схема auth ─────────────────────────────────────────────────────────────

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Один в один с реализацией Supabase: sub из клеймов текущего запроса
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

grant usage on schema auth to authenticated, anon, service_role;
grant select on auth.users to authenticated, service_role;


-- ─── Схема storage ──────────────────────────────────────────────────────────

create schema if not exists storage;

create table if not exists storage.buckets (
  id         text primary key,
  name       text not null,
  public     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Разбивает путь на сегменты каталогов: 'a/b/c.png' → {a,b}
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;


-- ─── Утилита для тестов: войти под пользователем ────────────────────────────

create or replace function auth.login_as(p_user uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    false
  );
end;
$$;

create or replace function auth.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', false);
end;
$$;
