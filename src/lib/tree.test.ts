import { describe, it, expect } from 'vitest';

import { groupBySpace, flattenItems, expiringSoon } from './tree';
import type { SpaceLike, ItemLike } from './tree';

const kitchen: SpaceLike = { id: 'k', name: 'Кухня', sort_order: 10 };
const bath: SpaceLike = { id: 'b', name: 'Ванная', sort_order: 20 };
const cupboard: SpaceLike = { id: 'c', name: 'Шкаф под мойкой', parent_id: 'k', sort_order: 10 };

const spaces = [bath, kitchen, cupboard];

const fridge: ItemLike = { id: '1', name: 'Холодильник', space_id: 'k' };
const kettle: ItemLike = { id: '2', name: 'Чайник', space_id: 'k' };
const cleaner: ItemLike = { id: '3', name: 'Средство для мытья', space_id: 'c' };
const boiler: ItemLike = { id: '4', name: 'Бойлер', space_id: 'b' };
const carKit: ItemLike = { id: '5', name: 'Аптечка в машине', space_id: null };

describe('groupBySpace', () => {
  it('раскладывает вещи по комнатам', () => {
    const groups = groupBySpace(spaces, [fridge, boiler]);
    expect(groups.map((g) => g.space?.name)).toEqual(['Кухня', 'Ванная']);
    expect(groups[0]?.items).toEqual([fridge]);
    expect(groups[1]?.items).toEqual([boiler]);
  });

  it('сортирует комнаты по sort_order', () => {
    const groups = groupBySpace([bath, kitchen], []);
    expect(groups.map((g) => g.space?.name)).toEqual(['Кухня', 'Ванная']);
  });

  it('вкладывает зоны в комнату', () => {
    const groups = groupBySpace(spaces, [fridge, cleaner]);
    const kitchenGroup = groups[0];
    expect(kitchenGroup?.children).toHaveLength(1);
    expect(kitchenGroup?.children[0]?.space?.name).toBe('Шкаф под мойкой');
    expect(kitchenGroup?.children[0]?.items).toEqual([cleaner]);
  });

  it('считает вещи вместе с вложенными зонами', () => {
    const groups = groupBySpace(spaces, [fridge, kettle, cleaner]);
    expect(groups[0]?.totalItems).toBe(3);
  });

  it('вещь без комнаты не теряется', () => {
    const groups = groupBySpace(spaces, [fridge, carKit]);
    const orphans = groups.find((g) => g.space === null);
    expect(orphans?.items).toEqual([carKit]);
  });

  it('вещь из удалённой комнаты тоже не теряется', () => {
    // Комнату удалили на другом телефоне, пока этот был офлайн
    const ghost: ItemLike = { id: '9', name: 'Сирота', space_id: 'удалённая' };
    const groups = groupBySpace(spaces, [ghost]);
    expect(groups.find((g) => g.space === null)?.items).toEqual([ghost]);
  });

  it('группа «без комнаты» всегда последняя', () => {
    const groups = groupBySpace(spaces, [carKit, fridge]);
    expect(groups[groups.length - 1]?.space).toBeNull();
  });

  it('не создаёт пустую группу «без комнаты», когда всё разложено', () => {
    const groups = groupBySpace(spaces, [fridge]);
    expect(groups.some((g) => g.space === null)).toBe(false);
  });

  it('работает на пустом доме', () => {
    expect(groupBySpace([], [])).toEqual([]);
  });
});

describe('flattenItems', () => {
  it('собирает вещи комнаты и всех её зон', () => {
    const groups = groupBySpace(spaces, [fridge, kettle, cleaner]);
    const names = flattenItems(groups[0]!).map((i) => i.name);
    expect(names).toEqual(['Холодильник', 'Чайник', 'Средство для мытья']);
  });
});

describe('expiringSoon', () => {
  const now = new Date('2026-08-10T00:00:00Z');

  it('находит гарантию, которая заканчивается на днях', () => {
    const soon: ItemLike = { id: 's', name: 'Микроволновка', space_id: 'k', warranty_until: '2026-08-25' };
    const groups = groupBySpace(spaces, [soon]);
    expect(expiringSoon(groups[0]!, 30, now)).toHaveLength(1);
  });

  it('не считает уже истёкшую', () => {
    const past: ItemLike = { id: 'p', name: 'Старый ТВ', space_id: 'k', warranty_until: '2025-01-01' };
    const groups = groupBySpace(spaces, [past]);
    expect(expiringSoon(groups[0]!, 30, now)).toHaveLength(0);
  });

  it('не считает далёкую', () => {
    const far: ItemLike = { id: 'f', name: 'Новая плита', space_id: 'k', warranty_until: '2028-01-01' };
    const groups = groupBySpace(spaces, [far]);
    expect(expiringSoon(groups[0]!, 30, now)).toHaveLength(0);
  });

  it('заглядывает во вложенные зоны', () => {
    const inCupboard: ItemLike = { id: 'z', name: 'Фильтр', space_id: 'c', warranty_until: '2026-08-15' };
    const groups = groupBySpace(spaces, [inCupboard]);
    expect(expiringSoon(groups[0]!, 30, now)).toHaveLength(1);
  });

  it('игнорирует вещи без даты и с мусором в дате', () => {
    const items: ItemLike[] = [
      { id: 'a', name: 'Без даты', space_id: 'k' },
      { id: 'b', name: 'Мусор', space_id: 'k', warranty_until: 'скоро' },
    ];
    const groups = groupBySpace(spaces, items);
    expect(expiringSoon(groups[0]!, 30, now)).toHaveLength(0);
  });
});
