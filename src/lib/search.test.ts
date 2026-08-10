import { describe, it, expect } from 'vitest';

import { normalize, fromWrongLayout, matches, searchItems } from './search';
import type { Searchable } from './search';

const fridge: Searchable = {
  name: 'Холодильник',
  brand: 'Samsung',
  model: 'RB37J5000SA',
  serial_number: 'SN-2024-8891',
  notes: 'Стоит в углу, ручка справа',
};

const boiler: Searchable = { name: 'Бойлер', brand: 'Ariston', model: 'ABS VLS' };
const tv: Searchable = { name: 'Телевизор', brand: 'LG', notes: 'Гостиная' };

const all = [fridge, boiler, tv];

describe('normalize', () => {
  it('приводит к нижнему регистру', () => {
    expect(normalize('ХОЛОДИЛЬНИК')).toBe('холодильник');
  });

  it('считает ё и е одной буквой — их набирают как придётся', () => {
    expect(normalize('Ёлка')).toBe(normalize('Елка'));
  });

  it('схлопывает разделители в пробел', () => {
    expect(normalize('SN-2024_8891')).toBe('sn 2024 8891');
  });
});

describe('fromWrongLayout', () => {
  it('исправляет ввод в неверной раскладке', () => {
    expect(fromWrongLayout('[jkjlbkmybr')).toBe('холодильник');
  });

  it('не портит то, что и так по-русски', () => {
    expect(fromWrongLayout('холодильник')).toBe('холодильник');
  });
});

describe('matches', () => {
  it('находит по названию', () => {
    expect(matches(fridge, 'холод')).toBe(true);
  });

  it('находит по бренду', () => {
    expect(matches(fridge, 'samsung')).toBe(true);
  });

  it('находит по серийнику с дефисами и без', () => {
    expect(matches(fridge, 'SN-2024-8891')).toBe(true);
    expect(matches(fridge, '20248891')).toBe(false); // склеенное — уже другая строка
    expect(matches(fridge, '2024 8891')).toBe(true);
  });

  it('находит по словам в любом порядке', () => {
    expect(matches(fridge, 'самсунг холодильник')).toBe(false); // «самсунг» кириллицей
    expect(matches(fridge, 'samsung холодильник')).toBe(true);
    expect(matches(fridge, 'холодильник samsung')).toBe(true);
  });

  it('прощает забытую раскладку', () => {
    expect(matches(fridge, '[jkjlbkmybr')).toBe(true);
  });

  it('ищет по заметкам', () => {
    expect(matches(fridge, 'ручка справа')).toBe(true);
  });

  it('не находит того, чего нет', () => {
    expect(matches(fridge, 'посудомойка')).toBe(false);
  });

  it('на пустой запрос не находит ничего', () => {
    expect(matches(fridge, '')).toBe(false);
    expect(matches(fridge, '   ')).toBe(false);
  });
});

describe('searchItems', () => {
  it('на пустой запрос возвращает пустой список, а не всё подряд', () => {
    expect(searchItems(all, '')).toEqual([]);
  });

  it('отбирает подходящее', () => {
    expect(searchItems(all, 'бойлер')).toEqual([boiler]);
  });

  it('совпадение в начале названия важнее совпадения в заметках', () => {
    const items: Searchable[] = [
      { name: 'Чайник', notes: 'рядом с телевизором' },
      { name: 'Телевизор' },
    ];
    expect(searchItems(items, 'телевизор')[0]?.name).toBe('Телевизор');
  });

  it('при равном весе сортирует по-русски', () => {
    const items: Searchable[] = [
      { name: 'Яблоко', notes: 'техника' },
      { name: 'Автомобиль', notes: 'техника' },
      { name: 'Бойлер', notes: 'техника' },
    ];
    expect(searchItems(items, 'техника').map((i) => i.name)).toEqual([
      'Автомобиль',
      'Бойлер',
      'Яблоко',
    ]);
  });
});
