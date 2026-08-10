import { describe, it, expect } from 'vitest';

import { bucketOf, groupTasks } from './tasks';
import type { TaskLike } from './tasks';

const now = new Date('2026-08-10T12:00:00Z');

function task(overrides: Partial<TaskLike> & { id?: string } = {}): TaskLike & { id: string } {
  return { id: 't', status: 'open', due_at: null, ...overrides };
}

describe('bucketOf', () => {
  it('вчерашнее — просрочено', () => {
    expect(bucketOf(task({ due_at: '2026-08-09T10:00:00Z' }), now)).toBe('overdue');
  });

  it('сегодняшнее — на сегодня, даже если час уже прошёл', () => {
    expect(bucketOf(task({ due_at: '2026-08-10T08:00:00Z' }), now)).toBe('today');
    expect(bucketOf(task({ due_at: '2026-08-10T20:00:00Z' }), now)).toBe('today');
  });

  it('в пределах недели — скоро', () => {
    expect(bucketOf(task({ due_at: '2026-08-14T10:00:00Z' }), now)).toBe('soon');
  });

  it('дальше недели — потом', () => {
    expect(bucketOf(task({ due_at: '2026-09-20T10:00:00Z' }), now)).toBe('later');
  });

  it('без срока — потом, а не просрочено', () => {
    expect(bucketOf(task({ due_at: null }), now)).toBe('later');
  });

  it('мусор в дате не делает задачу просроченной', () => {
    expect(bucketOf(task({ due_at: 'когда-нибудь' }), now)).toBe('later');
  });

  it('закрытая задача уходит из работы независимо от срока', () => {
    expect(bucketOf(task({ due_at: '2026-01-01T00:00:00Z', status: 'done' }), now)).toBe('done');
    expect(bucketOf(task({ due_at: '2026-01-01T00:00:00Z', status: 'skipped' }), now)).toBe('done');
  });
});

describe('groupTasks', () => {
  it('раскладывает по группам', () => {
    const tasks = [
      task({ id: '1', due_at: '2026-08-01T00:00:00Z' }),
      task({ id: '2', due_at: '2026-08-10T09:00:00Z' }),
      task({ id: '3', due_at: '2026-08-12T00:00:00Z' }),
      task({ id: '4', status: 'done' }),
    ];
    const groups = groupTasks(tasks, now);

    expect(groups.get('overdue')?.map((item) => item.id)).toEqual(['1']);
    expect(groups.get('today')?.map((item) => item.id)).toEqual(['2']);
    expect(groups.get('soon')?.map((item) => item.id)).toEqual(['3']);
    expect(groups.get('done')?.map((item) => item.id)).toEqual(['4']);
  });

  it('пустых групп не создаёт — иначе экран зарастёт заголовками', () => {
    const groups = groupTasks([task({ due_at: '2026-08-10T09:00:00Z' })], now);
    expect([...groups.keys()]).toEqual(['today']);
  });

  it('на пустом списке даёт пустую карту', () => {
    expect(groupTasks([], now).size).toBe(0);
  });
});
