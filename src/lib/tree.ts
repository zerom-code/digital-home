/**
 * Раскладка дома по комнатам для экрана «Дом».
 *
 * Главное требование — ничего не терять. Вещь без комнаты (лежит в машине,
 * на балконе, «где-то») обязана оставаться видимой: человек её завёл, значит
 * она ему нужна. Такие вещи собираются в отдельную группу «Без комнаты».
 */

export interface SpaceLike {
  id: string;
  name: string | null;
  kind?: string | null;
  icon?: string | null;
  photo_path?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
}

export interface ItemLike {
  id: string;
  name: string;
  space_id?: string | null;
  photo_path?: string | null;
  warranty_until?: string | null;
  sort_order?: number | null;
}

export interface SpaceGroup<S extends SpaceLike, I extends ItemLike> {
  /** null — псевдогруппа «Без комнаты» */
  space: S | null;
  items: I[];
  /** Вложенные зоны: «Кухня → Шкаф под мойкой» */
  children: SpaceGroup<S, I>[];
  /** Вещей здесь и во вложенных зонах — это число показывается на карточке */
  totalItems: number;
}

const byOrder = (a: { sort_order?: number | null; name: string | null }, b: typeof a) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  (a.name ?? '').localeCompare(b.name ?? '', 'ru');

/**
 * Собирает комнаты верхнего уровня с их вещами и вложенными зонами.
 *
 * Вещи, чей space_id указывает на несуществующую комнату (комнату удалили,
 * пока телефон был офлайн), тоже попадают в «Без комнаты», а не исчезают.
 */
export function groupBySpace<S extends SpaceLike, I extends ItemLike>(
  spaces: S[],
  items: I[]
): SpaceGroup<S, I>[] {
  const known = new Set(spaces.map((s) => s.id));

  const itemsBySpace = new Map<string, I[]>();
  const orphans: I[] = [];

  for (const item of items) {
    const key = item.space_id;
    if (!key || !known.has(key)) {
      orphans.push(item);
      continue;
    }
    const bucket = itemsBySpace.get(key);
    if (bucket) bucket.push(item);
    else itemsBySpace.set(key, [item]);
  }

  const childrenOf = new Map<string, S[]>();
  const roots: S[] = [];

  for (const space of spaces) {
    const parent = space.parent_id;
    if (!parent || !known.has(parent)) {
      roots.push(space);
      continue;
    }
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(space);
    else childrenOf.set(parent, [space]);
  }

  const build = (space: S): SpaceGroup<S, I> => {
    const own = (itemsBySpace.get(space.id) ?? []).slice().sort(byOrder);
    const children = (childrenOf.get(space.id) ?? []).slice().sort(byOrder).map(build);
    const totalItems = own.length + children.reduce((sum, c) => sum + c.totalItems, 0);
    return { space, items: own, children, totalItems };
  };

  const groups = roots.slice().sort(byOrder).map(build);

  if (orphans.length > 0) {
    groups.push({
      space: null,
      items: orphans.slice().sort(byOrder),
      children: [],
      totalItems: orphans.length,
    });
  }

  return groups;
}

/** Плоский список всех вещей группы, включая вложенные зоны. */
export function flattenItems<S extends SpaceLike, I extends ItemLike>(
  group: SpaceGroup<S, I>
): I[] {
  return [...group.items, ...group.children.flatMap(flattenItems)];
}

/**
 * Сколько вещей в группе требуют внимания — на карточке комнаты это
 * маленькая пометка «⚠ 1 гарантия».
 */
export function expiringSoon<S extends SpaceLike, I extends ItemLike>(
  group: SpaceGroup<S, I>,
  withinDays = 30,
  now: Date = new Date()
): I[] {
  const limit = new Date(now);
  limit.setDate(limit.getDate() + withinDays);

  return flattenItems(group).filter((item) => {
    if (!item.warranty_until) return false;
    const until = new Date(item.warranty_until);
    if (Number.isNaN(until.getTime())) return false;
    return until >= now && until <= limit;
  });
}
