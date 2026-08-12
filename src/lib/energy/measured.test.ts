import { describe, it, expect } from 'vitest';

import { DAYS_PER_MONTH } from './calc';
import {
  MIN_ELAPSED_DAYS,
  OFFLINE_AFTER_MS,
  dailyPoints,
  isOnline,
  livePowerW,
  projectedMonthlyKwh,
} from './measured';

/** 5 марта, 00:00 — прошло ровно четверо суток месяца. */
const MARCH_5 = new Date(2026, 2, 5);

describe('пересчёт замера на полный месяц', () => {
  it('главный случай: расход за начало месяца не выдаётся за весь месяц', () => {
    // Ради этого функция и существует. Холодильник съел 4 кВт·ч за четыре
    // дня. Без пересчёта сверка увидит «4 кВт·ч против оценки в 32» и
    // объявит расчёт восьмикратно завышенным — хотя всё сходится
    const projected = projectedMonthlyKwh(4000, MARCH_5)!;

    expect(projected).toBeCloseTo(DAYS_PER_MONTH, 5);
    expect(projected).toBeGreaterThan(30);
  });

  it('месяц, пройденный целиком, пересчёт почти не меняет', () => {
    // 31 марта, конец суток: прошло 30 суток из среднего месяца в 30.44
    const end = new Date(2026, 2, 31);
    const projected = projectedMonthlyKwh(30_000, end)!;
    expect(projected).toBeCloseTo(30 * (DAYS_PER_MONTH / 30), 5);
    expect(Math.abs(projected - 30)).toBeLessThan(0.5);
  });

  it('первые часы месяца пересчёту не поддаются — null, а не выброс', () => {
    // 00:30 первого числа: чайник на 0.2 кВт·ч превратился бы в 300 кВт·ч/мес
    const justAfterMidnight = new Date(2026, 2, 1, 0, 30);
    expect(projectedMonthlyKwh(200, justAfterMidnight)).toBeNull();
  });

  it('граница в сутки открывает пересчёт', () => {
    const exactlyOneDay = new Date(2026, 2, 1 + MIN_ELAPSED_DAYS);
    expect(projectedMonthlyKwh(1000, exactlyOneDay)).not.toBeNull();
  });

  it('нулевой расход — это ноль, а не «нет данных»', () => {
    // Прибор выключен весь месяц: это осмысленный факт, его надо показать
    expect(projectedMonthlyKwh(0, MARCH_5)).toBe(0);
  });

  it('мусор и отрицательные значения не превращаются в число', () => {
    expect(projectedMonthlyKwh(null, MARCH_5)).toBeNull();
    expect(projectedMonthlyKwh(Number.NaN, MARCH_5)).toBeNull();
    expect(projectedMonthlyKwh(-5, MARCH_5)).toBeNull();
  });
});

describe('связь с мостом', () => {
  const now = new Date('2026-03-05T12:00:00Z');

  it('свежий замер — на связи', () => {
    expect(isOnline('2026-03-05T11:59:00Z', now)).toBe(true);
  });

  it('молчание дольше порога — не на связи', () => {
    const stale = new Date(now.getTime() - OFFLINE_AFTER_MS - 1000).toISOString();
    expect(isOnline(stale, now)).toBe(false);
  });

  it('без замеров вовсе — не на связи', () => {
    expect(isOnline(null, now)).toBe(false);
    expect(isOnline('не дата', now)).toBe(false);
  });
});

describe('текущая мощность', () => {
  const now = new Date('2026-03-05T12:00:00Z');

  it('на связи — отдаём как есть', () => {
    expect(livePowerW({ last_power_w: 1800, last_seen_at: '2026-03-05T11:59:30Z' }, now)).toBe(1800);
  });

  it('мост отвалился — null, а не последнее известное', () => {
    // Показать вчерашние 2 кВт как «сейчас» значит соврать в самом заметном
    // месте экрана: человек решит, что прибор работает прямо сейчас
    const stale = new Date(now.getTime() - OFFLINE_AFTER_MS - 1).toISOString();
    expect(livePowerW({ last_power_w: 2000, last_seen_at: stale }, now)).toBeNull();
  });

  it('ноль ватт — это выключенный прибор, а не отсутствие данных', () => {
    expect(livePowerW({ last_power_w: 0, last_seen_at: '2026-03-05T11:59:30Z' }, now)).toBe(0);
  });
});

describe('ряд по дням', () => {
  it('ватт-часы переводятся в киловатт-часы', () => {
    expect(dailyPoints([{ day: '2026-03-01', wh: 2500 }])).toEqual([
      { day: '2026-03-01', kwh: 2.5 },
    ]);
  });

  it('дни без замеров выбрасываются, а не рисуются нулём', () => {
    // Нарисованный ноль читается как «прибор не работал», хотя на деле в этот
    // день просто не было связи
    const points = dailyPoints([
      { day: '2026-03-01', wh: 1000 },
      { day: '2026-03-02', wh: null },
      { day: '2026-03-03', wh: 0 },
    ]);
    expect(points.map((p) => p.day)).toEqual(['2026-03-01', '2026-03-03']);
  });
});
