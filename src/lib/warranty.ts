/**
 * Сроки гарантии.
 *
 * Считаются из того, что человек заполнил, а не требуют полного набора:
 * есть только дата покупки — берём типовой срок категории; указан срок
 * вручную — он побеждает. Ничего не заполнено — просто нет блока гарантии,
 * и это нормальное состояние, а не ошибка (ADR-006).
 */

export interface WarrantyInput {
  purchased_at?: string | null;
  warranty_months?: number | null;
  /** Дата окончания, введённая руками, — приоритетнее расчётной */
  warranty_until?: string | null;
  /** Типовой срок для категории из справочника */
  categoryDefaultMonths?: number | null;
}

export type WarrantyState = 'unknown' | 'active' | 'expiring' | 'expired';

export interface Warranty {
  state: WarrantyState;
  /** Дата окончания в формате YYYY-MM-DD, если её удалось определить */
  until: string | null;
  /** Сколько дней осталось; отрицательное — сколько прошло с окончания */
  daysLeft: number | null;
  /** Срок взят из типовых значений категории, а не от пользователя */
  estimated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Порог, после которого гарантию показываем как «скоро закончится». */
export const EXPIRING_SOON_DAYS = 30;

function toDate(value: string): Date | null {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getUTCMonth() + months;
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);

  // 31 января + 1 месяц — это 28 (или 29) февраля, а не 3 марта
  const lastDayOfMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfMonth));

  return result;
}

export function computeWarranty(input: WarrantyInput, now: Date = new Date()): Warranty {
  const empty: Warranty = { state: 'unknown', until: null, daysLeft: null, estimated: false };

  let until: Date | null = null;
  let estimated = false;

  if (input.warranty_until) {
    until = toDate(input.warranty_until);
  } else if (input.purchased_at) {
    const purchased = toDate(input.purchased_at);
    const months = input.warranty_months ?? input.categoryDefaultMonths ?? null;
    if (purchased && months && months > 0) {
      until = addMonths(purchased, months);
      estimated = input.warranty_months == null;
    }
  }

  if (!until) return empty;

  const today = toDate(toIso(now));
  if (!today) return empty;

  const daysLeft = Math.round((until.getTime() - today.getTime()) / DAY_MS);

  let state: WarrantyState;
  if (daysLeft < 0) state = 'expired';
  else if (daysLeft <= EXPIRING_SOON_DAYS) state = 'expiring';
  else state = 'active';

  return { state, until: toIso(until), daysLeft, estimated };
}

/**
 * Человеческая подпись под сроком.
 *
 * Не «Осталось 487 дн.», а «Действует ещё 1 год 4 месяца» — по-русски и без
 * сокращений (docs/04-ux.md).
 */
export function describeWarranty(warranty: Warranty): string | null {
  if (warranty.state === 'unknown' || warranty.daysLeft == null) return null;

  const days = Math.abs(warranty.daysLeft);

  if (warranty.state === 'expired') {
    return days === 0 ? 'Закончилась сегодня' : `Закончилась ${plural(days, 'день', 'дня', 'дней')} назад`;
  }

  if (days === 0) return 'Заканчивается сегодня';
  if (days < 45) return `Действует ещё ${plural(days, 'день', 'дня', 'дней')}`;

  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);

  const parts: string[] = [];
  if (years > 0) parts.push(plural(years, 'год', 'года', 'лет'));
  if (months > 0) parts.push(plural(months, 'месяц', 'месяца', 'месяцев'));
  if (parts.length === 0) parts.push(plural(days, 'день', 'дня', 'дней'));

  return `Действует ещё ${parts.join(' ')}`;
}

/** Русское склонение числительных: 1 день, 2 дня, 5 дней. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;

  let word: string;
  if (mod100 >= 11 && mod100 <= 14) word = many;
  else if (mod10 === 1) word = one;
  else if (mod10 >= 2 && mod10 <= 4) word = few;
  else word = many;

  return `${n} ${word}`;
}
