#!/usr/bin/env bash
# ============================================================================
# db-test.sh — накатывает миграции на чистую БД и прогоняет тесты RLS
#
# Нужен локальный PostgreSQL 16+. Стек Supabase не требуется: схемы auth и
# storage подменяет supabase/tests/shim_supabase.sql.
#
#   bash scripts/db-test.sh
#   DB=domovoy_dev KEEP=1 bash scripts/db-test.sh   # оставить БД после прогона
# ============================================================================

set -euo pipefail

DB="${DB:-domovoy_test}"
KEEP="${KEEP:-0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Под root подключаемся к Postgres через служебного пользователя postgres
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $(printf '%q ' "$@")"; }
  admin_run() { su postgres -c "$*"; }
else
  psql_run() { psql "$@"; }
  admin_run() { eval "$*"; }
fi

echo "▸ пересоздаю базу $DB"
admin_run "dropdb --if-exists '$DB'" >/dev/null 2>&1 || true
admin_run "createdb '$DB'"

apply() {
  local file="$1"
  printf '  %-42s' "$(basename "$file")"
  if psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/$file" >/dev/null 2>/tmp/dbtest.err; then
    echo "ок"
  else
    echo "ОШИБКА"
    sed 's/^/    /' /tmp/dbtest.err
    exit 1
  fi
}

echo "▸ подмена схем Supabase"
apply supabase/tests/shim_supabase.sql

echo "▸ миграции"
for f in "$ROOT"/supabase/migrations/*.sql; do
  apply "supabase/migrations/$(basename "$f")"
done

echo "▸ справочник категорий"
node "$ROOT/scripts/build-seed.mjs"
apply supabase/seed/categories.sql

echo "▸ тесты RLS"
if ! psql_run -v ON_ERROR_STOP=1 -q -d "$DB" -f "$ROOT/supabase/tests/rls_test.sql" 2>&1 |
     sed -e 's/^psql:[^ ]*: NOTICE:  //' -e 's/^NOTICE:  //'; then
  echo "ТЕСТЫ ПРОВАЛЕНЫ"
  exit 1
fi

if [ "$KEEP" = "1" ]; then
  echo "база $DB оставлена"
else
  admin_run "dropdb --if-exists '$DB'"
fi
