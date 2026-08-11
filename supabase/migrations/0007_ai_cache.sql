-- ============================================================================
-- Кеш ответов ИИ (фаза 4, docs/08-ai.md)
--
-- Одна и та же табличка, комната или чек не распознаются дважды — ключ
-- хеш содержимого запроса. Кеш общий между семьями сознательно: результат
-- зависит только от содержимого снимка, а не от того, кто его прислал, и
-- хранит не сам снимок, а только разобранные поля.
-- ============================================================================

create table public.ai_cache (
  input_hash varchar primary key,
  feature    text not null,
  model      text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);

create index ai_cache_feature_idx on public.ai_cache (feature, created_at desc);

-- RLS включён, но политик для клиента нет: таблицу читает и пишет только
-- Edge Function под service_role, которая RLS обходит. Обычный пользователь
-- не должен доставать чужие результаты по хешу.
alter table public.ai_cache enable row level security;
