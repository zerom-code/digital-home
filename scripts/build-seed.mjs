#!/usr/bin/env node
// ============================================================================
// build-seed.mjs — data/categories.ru.json → supabase/seed/categories.sql
//
// Справочник категорий редактируется как JSON (его удобно читать и
// дополнять), а в базу едет сгенерированным SQL. Генератор без зависимостей:
// запускается голым node.
//
//   node scripts/build-seed.mjs
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data', 'categories.ru.json');
const out = join(root, 'supabase', 'seed', 'categories.sql');

/** Колонки таблицы item_categories в порядке вставки. */
const COLUMNS = [
  ['id', 'id'],
  ['parent_id', 'parent_id'],
  ['name_ru', 'name_ru'],
  ['icon', 'icon'],
  ['sort_order', 'sort_order'],
  ['default_energy_mode', 'default_energy_mode'],
  ['default_power_w', 'default_power_w'],
  ['default_standby_w', 'default_standby_w'],
  ['default_duty_cycle', 'default_duty_cycle'],
  ['default_hours_per_day', 'default_hours_per_day'],
  ['default_kwh_per_cycle', 'default_kwh_per_cycle'],
  ['default_cycles_per_week', 'default_cycles_per_week'],
  ['label_unit', 'label_unit'],
  ['default_warranty_months', 'default_warranty_months'],
  ['default_service_interval_days', 'default_service_interval_days'],
];

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

function literal(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return quote(value);
}

const data = JSON.parse(readFileSync(src, 'utf8'));
const categories = data.categories ?? [];

// Родители обязаны вставиться раньше детей: parent_id — внешний ключ на ту же
// таблицу. В JSON порядок правильный, но полагаться на это не будем.
const groups = categories.filter((c) => !c.parent_id);
const leaves = categories.filter((c) => c.parent_id);
const ordered = [...groups, ...leaves];

const known = new Set(categories.map((c) => c.id));
for (const c of leaves) {
  if (!known.has(c.parent_id)) {
    throw new Error(`У категории ${c.id} несуществующий parent_id: ${c.parent_id}`);
  }
}

// sort_order у групп задан в JSON явно, у листьев — нет: проставляем по
// порядку внутри группы, чтобы список в интерфейсе не прыгал между сборками.
const seen = new Map();
for (const c of leaves) {
  const n = (seen.get(c.parent_id) ?? 0) + 1;
  seen.set(c.parent_id, n);
  c.sort_order ??= n * 10;
}

const rows = ordered.map((c) => {
  const values = COLUMNS.map(([, key]) => literal(c[key]));
  return `  (${values.join(', ')})`;
});

const columnList = COLUMNS.map(([col]) => col).join(', ');

const sql = `-- ============================================================================
-- categories.sql — СГЕНЕРИРОВАННЫЙ ФАЙЛ, РУКАМИ НЕ ПРАВИТЬ
--
-- Источник: data/categories.ru.json
-- Генератор: node scripts/build-seed.mjs
--
-- Групп: ${groups.length}, категорий: ${leaves.length}, всего строк: ${ordered.length}
-- ============================================================================

insert into public.item_categories (${columnList})
values
${rows.join(',\n')}
on conflict (id) do update set
  parent_id                     = excluded.parent_id,
  name_ru                       = excluded.name_ru,
  icon                          = excluded.icon,
  sort_order                    = excluded.sort_order,
  default_energy_mode           = excluded.default_energy_mode,
  default_power_w               = excluded.default_power_w,
  default_standby_w             = excluded.default_standby_w,
  default_duty_cycle            = excluded.default_duty_cycle,
  default_hours_per_day         = excluded.default_hours_per_day,
  default_kwh_per_cycle         = excluded.default_kwh_per_cycle,
  default_cycles_per_week       = excluded.default_cycles_per_week,
  label_unit                    = excluded.label_unit,
  default_warranty_months       = excluded.default_warranty_months,
  default_service_interval_days = excluded.default_service_interval_days;
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql, 'utf8');

console.log(
  `categories.sql: ${ordered.length} строк ` +
  `(${groups.length} групп + ${leaves.length} категорий)`
);
