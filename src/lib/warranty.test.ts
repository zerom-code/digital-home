import { describe, it, expect } from 'vitest';

import { computeWarranty, describeWarranty, addMonths, plural } from './warranty';

const now = new Date('2026-08-10T12:00:00Z');

describe('addMonths', () => {
  it('прибавляет месяцы', () => {
    expect(addMonths(new Date('2024-03-01T00:00:00Z'), 24).toISOString().slice(0, 10))
      .toBe('2026-03-01');
    expect(addMonths(new Date('2024-03-01T00:00:00Z'), 1).toISOString().slice(0, 10))
      .toBe('2024-04-01');
  });

  it('не перескакивает через конец короткого месяца', () => {
    // 31 января + 1 месяц — это 29 февраля 2024 (високосный), а не 2 марта
    expect(addMonths(new Date('2024-01-31T00:00:00Z'), 1).toISOString().slice(0, 10))
      .toBe('2024-02-29');
    expect(addMonths(new Date('2025-01-31T00:00:00Z'), 1).toISOString().slice(0, 10))
      .toBe('2025-02-28');
  });
});

describe('computeWarranty', () => {
  it('без данных состояние неизвестно — и это не ошибка', () => {
    expect(computeWarranty({}, now)).toEqual({
      state: 'unknown', until: null, daysLeft: null, estimated: false,
    });
  });

  it('только дата покупки, без сроков — всё ещё неизвестно', () => {
    expect(computeWarranty({ purchased_at: '2024-03-01' }, now).state).toBe('unknown');
  });

  it('считает из даты покупки и срока', () => {
    const w = computeWarranty({ purchased_at: '2024-03-01', warranty_months: 36 }, now);
    expect(w.until).toBe('2027-03-01');
    expect(w.state).toBe('active');
    expect(w.estimated).toBe(false);
  });

  it('берёт типовой срок категории, если свой не указан', () => {
    const w = computeWarranty(
      { purchased_at: '2025-01-01', categoryDefaultMonths: 24 },
      now
    );
    expect(w.until).toBe('2027-01-01');
    expect(w.estimated).toBe(true);
  });

  it('свой срок побеждает типовой', () => {
    const w = computeWarranty(
      { purchased_at: '2025-01-01', warranty_months: 12, categoryDefaultMonths: 24 },
      now
    );
    expect(w.until).toBe('2026-01-01');
    expect(w.estimated).toBe(false);
  });

  it('дата, введённая руками, побеждает расчёт', () => {
    const w = computeWarranty(
      { purchased_at: '2024-03-01', warranty_months: 36, warranty_until: '2030-01-01' },
      now
    );
    expect(w.until).toBe('2030-01-01');
  });

  it('различает действующую, истекающую и истёкшую', () => {
    expect(computeWarranty({ warranty_until: '2027-01-01' }, now).state).toBe('active');
    expect(computeWarranty({ warranty_until: '2026-08-25' }, now).state).toBe('expiring');
    expect(computeWarranty({ warranty_until: '2026-08-10' }, now).state).toBe('expiring');
    expect(computeWarranty({ warranty_until: '2026-08-09' }, now).state).toBe('expired');
  });

  it('считает оставшиеся дни', () => {
    expect(computeWarranty({ warranty_until: '2026-08-20' }, now).daysLeft).toBe(10);
    expect(computeWarranty({ warranty_until: '2026-08-01' }, now).daysLeft).toBe(-9);
  });

  it('не падает на мусоре в дате', () => {
    expect(computeWarranty({ warranty_until: 'когда-нибудь' }, now).state).toBe('unknown');
    expect(computeWarranty({ purchased_at: 'давно', warranty_months: 12 }, now).state)
      .toBe('unknown');
  });

  it('игнорирует бессмысленный срок', () => {
    expect(computeWarranty({ purchased_at: '2025-01-01', warranty_months: 0 }, now).state)
      .toBe('unknown');
    expect(computeWarranty({ purchased_at: '2025-01-01', warranty_months: -5 }, now).state)
      .toBe('unknown');
  });
});

describe('describeWarranty', () => {
  const describe_ = (until: string) => describeWarranty(computeWarranty({ warranty_until: until }, now));

  it('молчит, когда нечего сказать', () => {
    expect(describeWarranty(computeWarranty({}, now))).toBeNull();
  });

  it('говорит по-русски про годы и месяцы', () => {
    expect(describe_('2028-01-01')).toBe('Действует ещё 1 год 4 месяца');
  });

  it('про короткий срок говорит днями', () => {
    expect(describe_('2026-08-20')).toBe('Действует ещё 10 дней');
    expect(describe_('2026-08-11')).toBe('Действует ещё 1 день');
    expect(describe_('2026-08-12')).toBe('Действует ещё 2 дня');
  });

  it('отдельно отмечает сегодняшний день', () => {
    expect(describe_('2026-08-10')).toBe('Заканчивается сегодня');
  });

  it('про истёкшую говорит в прошедшем времени', () => {
    expect(describe_('2026-08-05')).toBe('Закончилась 5 дней назад');
  });
});

describe('plural', () => {
  it('склоняет по правилам русского языка', () => {
    expect(plural(1, 'день', 'дня', 'дней')).toBe('1 день');
    expect(plural(2, 'день', 'дня', 'дней')).toBe('2 дня');
    expect(plural(5, 'день', 'дня', 'дней')).toBe('5 дней');
    expect(plural(11, 'день', 'дня', 'дней')).toBe('11 дней');
    expect(plural(21, 'день', 'дня', 'дней')).toBe('21 день');
    expect(plural(112, 'день', 'дня', 'дней')).toBe('112 дней');
    expect(plural(122, 'день', 'дня', 'дней')).toBe('122 дня');
  });
});
