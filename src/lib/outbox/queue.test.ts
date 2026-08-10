import { describe, it, expect } from 'vitest';

import { compact, due, stuck, markFailed, isPermanent, summarize, ordered } from './queue';
import type { Entry, Operation } from './types';
import { MAX_ATTEMPTS } from './types';

let clock = 1000;

function entry(op: Operation, overrides: Partial<Entry> = {}): Entry {
  return {
    entryId: `e${clock++}`,
    op,
    createdAt: clock,
    attempts: 0,
    nextAttemptAt: 0,
    ...overrides,
  };
}

const upsert = (id: string, payload: Record<string, unknown> = {}): Operation => ({
  kind: 'upsert', table: 'items', id, payload: { name: 'Вещь', ...payload },
});
const update = (id: string, patch: Record<string, unknown>): Operation => ({
  kind: 'update', table: 'items', id, patch,
});
const remove = (id: string): Operation => ({ kind: 'delete', table: 'items', id });
const upload = (path: string, attachId?: string): Operation => ({
  kind: 'upload',
  bucket: 'docs',
  path,
  blobKey: `blob:${path}`,
  contentType: 'image/jpeg',
  ...(attachId
    ? { attachTo: { table: 'items' as const, id: attachId, column: 'photo_path' } }
    : {}),
});

describe('compact', () => {
  it('пустую очередь оставляет пустой', () => {
    expect(compact([])).toEqual([]);
  });

  it('не трогает независимые записи', () => {
    const list = [entry(upsert('a')), entry(upsert('b'))];
    expect(compact(list)).toHaveLength(2);
  });

  it('сливает несколько правок одной строки', () => {
    const list = [
      entry(update('a', { name: 'Раз' })),
      entry(update('a', { brand: 'Samsung' })),
      entry(update('a', { name: 'Два' })),
    ];
    const result = compact(list);

    expect(result).toHaveLength(1);
    expect(result[0]?.op).toEqual({
      kind: 'update',
      table: 'items',
      id: 'a',
      patch: { name: 'Два', brand: 'Samsung' },
    });
  });

  it('вливает правку в ещё не отправленное создание', () => {
    const list = [entry(upsert('a', { name: 'Черновик' })), entry(update('a', { name: 'Готово' }))];
    const result = compact(list);

    expect(result).toHaveLength(1);
    expect(result[0]?.op.kind).toBe('upsert');
    expect((result[0]?.op as { payload: Record<string, unknown> }).payload['name']).toBe('Готово');
  });

  it('создание и удаление офлайн взаимно уничтожаются', () => {
    // Сервер об этой вещи никогда не узнает — и не должен
    const list = [entry(upsert('a')), entry(remove('a'))];
    expect(compact(list)).toEqual([]);
  });

  it('вместе с ними снимается и загрузка фото', () => {
    const list = [entry(upsert('a')), entry(upload('docs/a.jpg', 'a')), entry(remove('a'))];
    expect(compact(list)).toEqual([]);
  });

  it('удаление поверх правок отменяет их', () => {
    const list = [entry(update('a', { name: 'Неважно' })), entry(remove('a'))];
    const result = compact(list);

    expect(result).toHaveLength(1);
    expect(result[0]?.op.kind).toBe('delete');
  });

  it('восстановление после удаления отправляется как создание', () => {
    const list = [entry(remove('a')), entry(upsert('a'))];
    const result = compact(list);

    expect(result).toHaveLength(1);
    expect(result[0]?.op.kind).toBe('upsert');
  });

  it('загрузки не сливаются между собой — файлы разные', () => {
    const list = [entry(upload('docs/1.jpg')), entry(upload('docs/2.jpg'))];
    expect(compact(list)).toHaveLength(2);
  });

  it('не путает строки из разных таблиц с одинаковым id', () => {
    const list = [
      entry({ kind: 'update', table: 'items', id: 'x', patch: { name: 'Вещь' } }),
      entry({ kind: 'update', table: 'spaces', id: 'x', patch: { name: 'Комната' } }),
    ];
    expect(compact(list)).toHaveLength(2);
  });

  it('переживает длинную цепочку правок', () => {
    const list = [
      entry(upsert('a', { name: 'Шаг 0' })),
      ...Array.from({ length: 20 }, (_, i) => entry(update('a', { name: `Шаг ${i + 1}` }))),
    ];
    const result = compact(list);

    expect(result).toHaveLength(1);
    expect((result[0]?.op as { payload: Record<string, unknown> }).payload['name']).toBe('Шаг 20');
  });
});

describe('due и stuck', () => {
  it('берёт только те, чей срок подошёл', () => {
    const list = [
      entry(upsert('a'), { nextAttemptAt: 500 }),
      entry(upsert('b'), { nextAttemptAt: 5000 }),
    ];
    expect(due(list, 1000)).toHaveLength(1);
  });

  it('исчерпавшие попытки не берутся в работу', () => {
    const list = [entry(upsert('a'), { attempts: MAX_ATTEMPTS, nextAttemptAt: 0 })];
    expect(due(list, 10_000)).toHaveLength(0);
    expect(stuck(list)).toHaveLength(1);
  });
});

describe('markFailed', () => {
  it('увеличивает счётчик и отодвигает следующую попытку', () => {
    const original = entry(upsert('a'));
    const failed = markFailed(original, 'сеть недоступна', 10_000);

    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe('сеть недоступна');
    expect(failed.nextAttemptAt).toBeGreaterThan(10_000);
  });

  it('откат растёт с числом попыток', () => {
    const first = markFailed(entry(upsert('a')), 'ошибка', 0);
    const later = markFailed({ ...first, attempts: 3 }, 'ошибка', 0);

    expect(later.nextAttemptAt).toBeGreaterThan(first.nextAttemptAt);
  });

  it('окончательный отказ не повторяется', () => {
    const failed = markFailed(entry(upsert('a')), 'нет прав', 0, true);
    expect(failed.attempts).toBe(MAX_ATTEMPTS);
    expect(due([failed], 999_999)).toHaveLength(0);
  });
});

describe('isPermanent', () => {
  it('4xx повторять бессмысленно', () => {
    expect(isPermanent(403)).toBe(true);
    expect(isPermanent(404)).toBe(true);
    expect(isPermanent(422)).toBe(true);
  });

  it('кроме таймаута и превышения лимита', () => {
    expect(isPermanent(408)).toBe(false);
    expect(isPermanent(429)).toBe(false);
  });

  it('5xx и отсутствие ответа — временные', () => {
    expect(isPermanent(500)).toBe(false);
    expect(isPermanent(503)).toBe(false);
    expect(isPermanent(undefined)).toBe(false);
  });
});

describe('summarize', () => {
  it('делит очередь на ждущие и застрявшие', () => {
    const list = [
      entry(upsert('a')),
      entry(upsert('b')),
      entry(upsert('c'), { attempts: MAX_ATTEMPTS }),
    ];
    expect(summarize(list)).toEqual({ pending: 2, stuck: 1 });
  });

  it('на пустой очереди даёт нули', () => {
    expect(summarize([])).toEqual({ pending: 0, stuck: 0 });
  });
});

describe('ordered', () => {
  it('отправляет в порядке создания — причина раньше следствия', () => {
    const first = entry(upsert('a'), { createdAt: 100 });
    const second = entry(update('a', { name: 'Потом' }), { createdAt: 200 });
    const result = ordered([second, first]);

    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });
});
