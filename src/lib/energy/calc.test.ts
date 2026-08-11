import { describe, it, expect } from 'vitest';

import {
  DAYS_PER_MONTH,
  WEEKS_PER_MONTH,
  estimate,
  monthlyCost,
  monthlyKwh,
  nightShare,
  nightWindowHours,
  totals,
} from './calc';
import type { EnergyInput, TariffInput } from './calc';

const single: TariffInput = { kind: 'single', rate_day: 4.32 };
const twoZone: TariffInput = {
  kind: 'two_zone',
  rate_day: 4.32,
  rate_night: 2.16,
  night_start: '23:00',
  night_end: '07:00',
};

/** Округление до копеек — сравнивать сырые float бессмысленно. */
const kop = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

describe('константы', () => {
  it('месяц — средний, а не «тридцать дней»', () => {
    expect(DAYS_PER_MONTH).toBeCloseTo(365.25 / 12, 2);
    expect(WEEKS_PER_MONTH).toBeCloseTo(365.25 / 12 / 7, 3);
  });
});

// ── Проверочные примеры из docs/03-energy.md. Считались вручную, поэтому
// расхождение здесь означает ошибку в реализации, а не в тесте ────────────

describe('пример 1: холодильник, режим typical', () => {
  const fridge: EnergyInput = { mode: 'typical', power_w: 150, duty_cycle: 0.3 };

  it('32.88 кВт·ч в месяц', () => {
    expect(kop(monthlyKwh(fridge))).toBe(32.88);
  });

  it('142.02 грн по одной зоне', () => {
    expect(kop(estimate(fridge, single).cost)).toBe(142.02);
  });

  it('118.35 грн по двум зонам', () => {
    // Ночью работает треть суток — ровно длина окна 23:00–07:00
    const result = estimate(fridge, twoZone);
    expect(result.nightShare).toBeCloseTo(1 / 3, 4);
    expect(kop(result.cost)).toBe(118.35);
  });

  it('без duty_cycle получилась бы бессмыслица — и это видно', () => {
    // 109 кВт·ч/мес у холодильника: ради этого duty_cycle и существует
    expect(Math.round(monthlyKwh({ mode: 'typical', power_w: 150 })!)).toBe(110);
  });
});

describe('пример 2: стиральная машина, режим per_cycle', () => {
  const washer: EnergyInput = { mode: 'per_cycle', kwh_per_cycle: 0.8, cycles_per_week: 4 };

  it('13.91 кВт·ч в месяц', () => {
    expect(kop(monthlyKwh(washer))).toBe(13.91);
  });

  it('60.11 грн', () => {
    expect(kop(estimate(washer, single).cost)).toBe(60.11);
  });

  it('ночной доли по умолчанию нет: когда стирают — неизвестно', () => {
    expect(nightShare(washer, twoZone)).toBe(0);
  });

  it('но её можно задать руками — стирка по таймеру на ночь', () => {
    const atNight = { ...washer, night_share: 1 };
    expect(kop(estimate(atNight, twoZone).cost)).toBe(kop(13.9136 * 2.16));
  });
});

describe('пример 3: холодильник по наклейке, kwh_year', () => {
  const byLabel: EnergyInput = { mode: 'label', label_value: 250, label_unit: 'kwh_year' };

  it('20.83 кВт·ч в месяц', () => {
    expect(kop(monthlyKwh(byLabel))).toBe(20.83);
  });

  it('90.00 грн', () => {
    expect(kop(estimate(byLabel, single).cost)).toBe(90);
  });
});

describe('пример 4: стиральная машина по наклейке, kwh_100cycles', () => {
  const byLabel: EnergyInput = {
    mode: 'label',
    label_value: 52,
    label_unit: 'kwh_100cycles',
    cycles_per_week: 4,
  };

  it('9.04 кВт·ч в месяц', () => {
    expect(kop(monthlyKwh(byLabel))).toBe(9.04);
  });

  it('39.07 грн', () => {
    expect(kop(estimate(byLabel, single).cost)).toBe(39.07);
  });
});

describe('главный тест: то же число 52 в разных единицах', () => {
  // Сравнение примеров 3 и 4 — ради него в схеме и появился label_unit.
  // Перепутать единицу значит ошибиться не на проценты, а на порядок
  const base = { mode: 'label' as const, label_value: 52, cycles_per_week: 4, hours_per_day: 4 };

  it('верно, как кВт·ч на 100 циклов — 9.04', () => {
    expect(kop(monthlyKwh({ ...base, label_unit: 'kwh_100cycles' }))).toBe(9.04);
  });

  it('ошибочно, как кВт·ч в год — вдвое меньше', () => {
    expect(kop(monthlyKwh({ ...base, label_unit: 'kwh_year' }))).toBe(4.33);
  });

  it('ошибочно, как кВт·ч на 1000 часов — совсем другое число', () => {
    expect(kop(monthlyKwh({ ...base, label_unit: 'kwh_1000h' }))).toBe(6.33);
  });
});

describe('пример 5: телевизор — два пути к одному ответу', () => {
  it('по наклейке и по мощности сходится', () => {
    const byLabel = monthlyKwh({
      mode: 'label',
      label_value: 100,
      label_unit: 'kwh_1000h',
      hours_per_day: 4,
    });
    const byPower = monthlyKwh({ mode: 'power_hours', power_w: 100, hours_per_day: 4 });

    expect(kop(byLabel)).toBe(12.18);
    expect(kop(byPower)).toBe(12.18);
  });
});

// ── Поведение вокруг формул ───────────────────────────────────────────────

describe('нехватка данных', () => {
  it('без мощности считать нечего — null, а не ноль', () => {
    // Ноль означал бы «не потребляет» и молча пропал бы из суммы
    expect(monthlyKwh({ mode: 'typical' })).toBeNull();
    expect(monthlyKwh({ mode: 'power_hours', power_w: 100 })).toBeNull();
    expect(monthlyKwh({ mode: 'per_cycle', kwh_per_cycle: 1 })).toBeNull();
  });

  it('наклейка без единицы бесполезна', () => {
    expect(monthlyKwh({ mode: 'label', label_value: 250 })).toBeNull();
  });

  it('наклейке на 100 циклов нужны циклы, а на 1000 часов — часы', () => {
    expect(monthlyKwh({ mode: 'label', label_value: 52, label_unit: 'kwh_100cycles' })).toBeNull();
    expect(monthlyKwh({ mode: 'label', label_value: 100, label_unit: 'kwh_1000h' })).toBeNull();
  });

  it('без тарифа есть киловатты, но нет гривен', () => {
    const result = estimate({ mode: 'typical', power_w: 150, duty_cycle: 0.3 }, { kind: 'single' });
    expect(result.kwh).not.toBeNull();
    expect(result.cost).toBeNull();
  });
});

describe('дежурный режим', () => {
  it('прибавляется к работе по расписанию', () => {
    const tv: EnergyInput = { mode: 'power_hours', power_w: 100, hours_per_day: 4, standby_w: 1 };
    // 12.176 активных + 1 Вт × 20 ч × 30.44 / 1000 = 0.6088
    expect(kop(monthlyKwh(tv))).toBe(12.78);
  });

  it('не прибавляется к наклейке — там он уже учтён', () => {
    const withStandby: EnergyInput = {
      mode: 'label',
      label_value: 250,
      label_unit: 'kwh_year',
      standby_w: 5,
    };
    expect(kop(monthlyKwh(withStandby))).toBe(20.83);
  });

  it('у круглосуточной техники дежурного времени нет', () => {
    const fridge: EnergyInput = { mode: 'typical', power_w: 150, duty_cycle: 0.3, standby_w: 5 };
    expect(kop(monthlyKwh(fridge))).toBe(32.88);
  });
});

describe('сезонность', () => {
  const heater: EnergyInput = {
    mode: 'power_hours',
    power_w: 1000,
    hours_per_day: 5,
    seasonality: { '1': 1.4, '7': 0.6 },
  };

  it('январь дороже, июль дешевле', () => {
    const base = monthlyKwh(heater)!;
    expect(kop(monthlyKwh(heater, 1))).toBe(kop(base * 1.4));
    expect(kop(monthlyKwh(heater, 7))).toBe(kop(base * 0.6));
  });

  it('месяц без множителя считается как обычный', () => {
    expect(kop(monthlyKwh(heater, 5))).toBe(kop(monthlyKwh(heater)!));
  });
});

describe('ночное окно', () => {
  it('23:00–07:00 — это восемь часов через полночь', () => {
    expect(nightWindowHours(twoZone)).toBe(8);
  });

  it('окно внутри суток считается напрямую', () => {
    expect(nightWindowHours({ ...twoZone, night_start: '01:00', night_end: '05:30' })).toBe(4.5);
  });

  it('по одной зоне ночной доли нет вовсе', () => {
    expect(nightShare({ mode: 'typical', power_w: 150 }, single)).toBe(0);
  });

  it('короткая работа целиком попадает в день', () => {
    expect(nightShare({ mode: 'power_hours', power_w: 100, hours_per_day: 4 }, twoZone)).toBe(0);
  });

  it('круглосуточная работа даёт ровно долю окна', () => {
    const share = nightShare({ mode: 'power_hours', power_w: 100, hours_per_day: 24 }, twoZone);
    expect(share).toBeCloseTo(8 / 24, 6);
  });

  it('в ночь заезжает только то, что не поместилось в день', () => {
    // 20 часов работы: 16 в дневном окне, 4 — уже ночью
    const share = nightShare({ mode: 'power_hours', power_w: 100, hours_per_day: 20 }, twoZone);
    expect(share).toBeCloseTo(4 / 20, 6);
  });
});

describe('ночная ставка по умолчанию', () => {
  it('не задана — берём половину дневной, а не ноль', () => {
    // Иначе ночь оказалась бы бесплатной и счёт вышел бы заниженным
    const withoutNight: TariffInput = { kind: 'two_zone', rate_day: 4.32, night_start: '23:00', night_end: '07:00' };
    expect(kop(monthlyCost(100, withoutNight, 0.5))).toBe(kop(100 * 0.5 * 4.32 + 100 * 0.5 * 2.16));
  });
});

describe('итог по квартире', () => {
  it('считает только посчитанное и не прячет остальное', () => {
    const result = totals([
      { kwh: 10, cost: 43.2, nightShare: 0 },
      { kwh: 5, cost: 21.6, nightShare: 0 },
      { kwh: null, cost: null, nightShare: 0 },
    ]);

    expect(result.kwh).toBe(15);
    expect(result.counted).toBe(2);
    expect(result.unknown).toBe(1);
    // Сумма денег — через toBeCloseTo: 43.2 + 21.6 в двоичной дроби даёт
    // 64.80000000000001. Округлять в расчёте ради красивого равенства нельзя,
    // это работа форматирования — сложение копеек тут ни при чём
    expect(result.cost).toBeCloseTo(64.8, 10);
  });

  it('вещь без стоимости не ломает сумму', () => {
    // Киловатты посчитались, а тариф не заполнен: вещь в итоге по расходу
    // есть, в деньгах её просто нет
    const result = totals([{ kwh: 10, cost: null, nightShare: 0 }]);
    expect(result).toEqual({ kwh: 10, cost: 0, unknown: 0, counted: 1 });
  });

  it('пустая квартира — нули, а не ошибка', () => {
    expect(totals([])).toEqual({ kwh: 0, cost: 0, unknown: 0, counted: 0 });
  });
});
