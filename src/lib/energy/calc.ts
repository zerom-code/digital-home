/**
 * Расчёт потребления и стоимости — весь целиком (docs/03-energy.md).
 *
 * Чистые функции без единого обращения к сети и базе: это единственный слой,
 * который можно проверить до последней цифры, и проверочные примеры из
 * документа лежат рядом в calc.test.ts как тестовые векторы.
 *
 * Сквозной принцип — **честность важнее точности**. Почти все поля вещи
 * необязательны (ADR-006), поэтому посчитать удаётся не всегда, и тогда
 * функции возвращают `null`, а не ноль. Ноль означал бы «прибор ничего не
 * потребляет», и в сумме по квартире такая вещь молча исчезла бы; `null`
 * означает «не знаем», и интерфейс скажет об этом вслух.
 */

/** 365.25 / 12 — средний месяц, а не «30 дней». */
export const DAYS_PER_MONTH = 30.44;

/** 365.25 / 12 / 7 — недель в среднем месяце. */
export const WEEKS_PER_MONTH = 4.348;

/**
 * Ночная ставка как доля дневной.
 *
 * Именно доля, а не готовое число: базовый тариф меняется, а схема «половина
 * дневного» держится годами (docs/03-energy.md). Зашитая константа устарела
 * бы вместе с очередным постановлением.
 */
export const NIGHT_RATE_SHARE = 0.5;

export type EnergyMode = 'typical' | 'label' | 'power_hours' | 'per_cycle';
export type LabelUnit = 'kwh_year' | 'kwh_100cycles' | 'kwh_1000h';
export type TariffKind = 'single' | 'two_zone';

/** Всё, что нужно для расчёта одной вещи. Любое поле может отсутствовать. */
export interface EnergyInput {
  mode: EnergyMode;
  power_w?: number | null;
  standby_w?: number | null;
  duty_cycle?: number | null;
  hours_per_day?: number | null;
  days_per_week?: number | null;
  kwh_per_cycle?: number | null;
  cycles_per_week?: number | null;
  label_value?: number | null;
  label_unit?: LabelUnit | null;
  night_share?: number | null;
  /** Множители по месяцам: {"1": 1.4, "7": 0.6}. */
  seasonality?: Record<string, number> | null;
}

export interface TariffInput {
  kind: TariffKind;
  rate_day?: number | null;
  rate_night?: number | null;
  /** 'HH:MM' или 'HH:MM:SS' — как отдаёт Postgres тип time. */
  night_start?: string | null;
  night_end?: string | null;
}

/** Положительное число или null — отсекает и undefined, и NaN, и мусор. */
function num(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Сколько часов в сутки прибор реально работает.
 *
 * Нужно только для дежурного режима: остальное время он потребляет standby.
 */
function activeHoursPerDay(input: EnergyInput): number {
  const hours = num(input.hours_per_day);
  if (hours !== null) return hours;
  // Холодильник включён в розетку круглосуточно: дежурного режима у него
  // нет вовсе, и добавлять его было бы выдумкой
  if (input.mode === 'typical') return 24;
  // Стиралка большую часть суток просто стоит включённой в сеть
  return 0;
}

/** Базовое потребление без дежурного режима и сезонности, кВт·ч/мес. */
function baseMonthlyKwh(input: EnergyInput): number | null {
  switch (input.mode) {
    case 'typical': {
      const power = num(input.power_w);
      if (power === null) return null;
      // Без duty_cycle считаем непрерывную работу: это худший случай, и он
      // хотя бы не занижает
      const duty = num(input.duty_cycle) ?? 1;
      return (power * 24 * DAYS_PER_MONTH * duty) / 1000;
    }

    case 'power_hours': {
      const power = num(input.power_w);
      const hours = num(input.hours_per_day);
      if (power === null || hours === null) return null;
      const days = num(input.days_per_week) ?? 7;
      return (power * hours * (days / 7) * DAYS_PER_MONTH) / 1000;
    }

    case 'per_cycle': {
      const perCycle = num(input.kwh_per_cycle);
      const cycles = num(input.cycles_per_week);
      if (perCycle === null || cycles === null) return null;
      return perCycle * cycles * WEEKS_PER_MONTH;
    }

    case 'label': {
      const value = num(input.label_value);
      if (value === null || !input.label_unit) return null;

      // Здесь легче всего ошибиться на порядок: после реформы наклеек ЕС
      // единица зависит от категории техники (docs/03-energy.md). Принять
      // «52 кВт·ч на 100 циклов» за кВт·ч за цикл — промах в сто раз
      switch (input.label_unit) {
        case 'kwh_year':
          return value / 12;

        case 'kwh_100cycles': {
          const cycles = num(input.cycles_per_week);
          if (cycles === null) return null;
          return (value / 100) * cycles * WEEKS_PER_MONTH;
        }

        case 'kwh_1000h': {
          const hours = num(input.hours_per_day);
          if (hours === null) return null;
          return (value / 1000) * hours * DAYS_PER_MONTH;
        }
      }
    }
  }
}

/**
 * Потребление за месяц, кВт·ч. `null` — данных не хватает.
 *
 * `month` (1–12) нужен только для сезонности; без неё роли не играет.
 */
export function monthlyKwh(input: EnergyInput, month?: number): number | null {
  const base = baseMonthlyKwh(input);
  if (base === null) return null;

  let kwh = base;

  // В наклейке дежурный режим уже учтён — добавлять его второй раз значит
  // просто завысить (docs/03-energy.md)
  const standby = num(input.standby_w);
  if (standby !== null && input.mode !== 'label') {
    const idleHours = Math.max(0, 24 - activeHoursPerDay(input));
    kwh += (standby * idleHours * DAYS_PER_MONTH) / 1000;
  }

  if (month !== undefined && input.seasonality) {
    const factor = num(input.seasonality[String(month)]);
    if (factor !== null) kwh *= factor;
  }

  return kwh;
}

/** Длина ночного окна в часах, с переходом через полночь. */
export function nightWindowHours(tariff: TariffInput): number {
  const start = parseTime(tariff.night_start) ?? 23;
  const end = parseTime(tariff.night_end) ?? 7;
  // Окно 23:00–07:00 переходит через полночь, поэтому не просто end - start
  const hours = end >= start ? end - start : 24 - start + end;
  return hours;
}

/** 'HH:MM' или 'HH:MM:SS' в часы с дробной частью. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours + minutes / 60;
}

/**
 * Какая доля потребления попадает в ночное окно.
 *
 * Расписания у нас нет — известно только, сколько часов в сутки прибор
 * работает. Поэтому считаем, что работает он сначала днём и залезает в ночь
 * лишь тем, что не поместилось в дневное окно. Правило простое, объяснимое
 * вслух и даёт верные крайние случаи: круглосуточная техника получает ровно
 * долю ночного окна, а телевизор на четыре часа — ноль.
 *
 * Всё это оценка, поэтому пользовательское `night_share` всегда главнее:
 * посудомойку по таймеру на ночь так не угадать.
 */
export function nightShare(input: EnergyInput, tariff: TariffInput): number {
  const explicit = num(input.night_share);
  if (explicit !== null) return clamp(explicit, 0, 1);

  if (tariff.kind !== 'two_zone') return 0;

  const nightHours = nightWindowHours(tariff);
  if (nightHours <= 0) return 0;

  if (input.mode === 'typical') {
    // Работает круглосуточно — ночью ровно столько, сколько длится окно
    const duty = num(input.duty_cycle);
    // duty_cycle равномерен по суткам, поэтому на долю не влияет
    void duty;
    return clamp(nightHours / 24, 0, 1);
  }

  if (input.mode === 'per_cycle') {
    // Когда именно запускают стирку — неизвестно, а врать в свою пользу
    // нельзя: по умолчанию считаем, что днём
    return 0;
  }

  const hours = num(input.hours_per_day);
  if (hours === null || hours <= 0) return 0;

  const dayWindowHours = 24 - nightHours;
  const spilledIntoNight = Math.max(0, hours - dayWindowHours);
  return clamp(spilledIntoNight / hours, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Стоимость месяца в гривнах. `null` — если тариф не заполнен.
 */
export function monthlyCost(
  kwh: number | null,
  tariff: TariffInput,
  share: number
): number | null {
  if (kwh === null) return null;

  const day = num(tariff.rate_day);
  if (day === null) return null;

  if (tariff.kind !== 'two_zone') return kwh * day;

  // Ночная ставка не задана — берём половину дневной, как принято в
  // двузонном учёте, а не считаем ночь бесплатной
  const night = num(tariff.rate_night) ?? day * NIGHT_RATE_SHARE;
  return kwh * (1 - share) * day + kwh * share * night;
}

export interface Estimate {
  /** кВт·ч в месяц; null — данных не хватает. */
  kwh: number | null;
  /** грн в месяц; null — не хватает данных или тарифа. */
  cost: number | null;
  /** Доля ночного потребления, по которой считали. */
  nightShare: number;
}

/** Всё вместе: то, что нужно карточке вещи и экрану «Энергия». */
export function estimate(
  input: EnergyInput,
  tariff: TariffInput,
  month?: number
): Estimate {
  const kwh = monthlyKwh(input, month);
  const share = nightShare(input, tariff);
  return { kwh, cost: monthlyCost(kwh, tariff, share), nightShare: share };
}

/** Итог по квартире: сумма посчитанного и честный счётчик непосчитанного. */
export interface Total {
  kwh: number;
  cost: number;
  /** Сколько вещей посчитать не удалось — интерфейс скажет об этом прямо. */
  unknown: number;
  /** Сколько вещей вошло в сумму. */
  counted: number;
}

export function totals(estimates: Estimate[]): Total {
  const total: Total = { kwh: 0, cost: 0, unknown: 0, counted: 0 };

  for (const item of estimates) {
    if (item.kwh === null) {
      total.unknown += 1;
      continue;
    }
    total.kwh += item.kwh;
    total.cost += item.cost ?? 0;
    total.counted += 1;
  }

  return total;
}
