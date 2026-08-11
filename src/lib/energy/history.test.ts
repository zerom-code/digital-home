import { describe, it, expect } from 'vitest';

import { usageSeries } from './history';
import type { ReadingPoint } from './history';

const reading = (read_at: string, value_day: number | null, value_night: number | null = null): ReadingPoint =>
  ({ read_at, value_day, value_night });

describe('usageSeries', () => {
  it('одного показания мало для расхода', () => {
    expect(usageSeries([reading('2026-01-01', 1000)])).toEqual([]);
  });

  it('расход — разница между соседними показаниями', () => {
    const points = usageSeries([reading('2026-01-01', 1000), reading('2026-01-31', 1300)]);
    expect(points).toHaveLength(1);
    expect(points[0]!.kwh).toBe(300);
    expect(points[0]!.days).toBe(30);
    expect(points[0]!.perMonth).toBeCloseTo((300 / 30) * 30.44, 4);
  });

  it('порядок на входе не важен — сортируем сами', () => {
    // Хук отдаёт свежие сверху, а рисовать нужно слева направо по времени
    const points = usageSeries([reading('2026-01-31', 1300), reading('2026-01-01', 1000)]);
    expect(points[0]!.from).toBe('2026-01-01');
    expect(points[0]!.to).toBe('2026-01-31');
  });

  it('обе зоны складываются', () => {
    const points = usageSeries([
      reading('2026-01-01', 1000, 500),
      reading('2026-01-31', 1200, 600),
    ]);
    expect(points[0]!.kwh).toBe(300);
  });

  it('счётчик назад — пара пропускается, а не даёт минус', () => {
    // Прибор заменили: показания пошли с нуля. Отрицательный расход на
    // графике был бы ложью, а придумывать нечего
    const points = usageSeries([
      reading('2026-01-01', 1000),
      reading('2026-02-01', 5),
      reading('2026-03-01', 300),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.kwh).toBe(295);
  });

  it('два показания за один день не делят на ноль', () => {
    const points = usageSeries([reading('2026-01-01', 1000), reading('2026-01-01', 1010)]);
    expect(points).toEqual([]);
  });

  it('показания без чисел не участвуют', () => {
    const points = usageSeries([
      reading('2026-01-01', null, null),
      reading('2026-01-15', 1000),
      reading('2026-02-14', 1300),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.kwh).toBe(300);
  });

  it('разные по длине периоды сравнимы через perMonth', () => {
    // Неделя и месяц с одинаковым суточным расходом должны дать одинаковый
    // столбик — иначе график врёт про «стало больше»
    const week = usageSeries([reading('2026-01-01', 0), reading('2026-01-08', 70)]);
    const month = usageSeries([reading('2026-02-01', 0), reading('2026-03-03', 300)]);
    expect(week[0]!.perMonth).toBeCloseTo(month[0]!.perMonth, 1);
  });
});
