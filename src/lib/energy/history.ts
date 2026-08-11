/**
 * Показания счётчика → расход между ними.
 *
 * Счётчик показывает нарастающий итог, а человека интересует расход. Разница
 * между соседними показаниями и есть расход за период; периоды получаются
 * рваные, потому что показания снимают когда придётся, а не первого числа —
 * поэтому рядом всегда лежит приведение к месяцу.
 */

const DAYS_PER_MONTH = 30.44;

export interface ReadingPoint {
  read_at: string;
  value_day: number | null;
  value_night: number | null;
}

export interface UsagePoint {
  /** Дата более раннего показания. */
  from: string;
  /** Дата более позднего показания. */
  to: string;
  /** Сколько дней прошло между ними. */
  days: number;
  /** Расход за период, кВт·ч. */
  kwh: number;
  /** Тот же расход в пересчёте на месяц — только так периоды сравнимы. */
  perMonth: number;
}

/** Сумма зон: у однозонного счётчика ночная просто пустая. */
function total(reading: ReadingPoint): number | null {
  const day = reading.value_day;
  const night = reading.value_night;
  if (day === null && night === null) return null;
  return (day ?? 0) + (night ?? 0);
}

const dayNumber = (iso: string) => Math.round(new Date(iso).getTime() / 86_400_000);

/**
 * Ряд расходов, от старых к новым.
 *
 * Порядок входа значения не имеет: показания сортируются сами. Пары, из
 * которых расход посчитать нельзя, молча пропускаются — их в ряду просто нет:
 *
 * - счётчик пошёл назад (заменили прибор или опечатались при вводе) —
 *   отрицательный расход показывать нельзя, а придумывать нечего;
 * - два показания в один день — делить на нулевой период не на что.
 */
export function usageSeries(readings: ReadingPoint[]): UsagePoint[] {
  const usable = readings
    .filter((reading) => total(reading) !== null)
    .sort((a, b) => dayNumber(a.read_at) - dayNumber(b.read_at));

  const points: UsagePoint[] = [];

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1]!;
    const current = usable[index]!;

    const days = dayNumber(current.read_at) - dayNumber(previous.read_at);
    if (days <= 0) continue;

    const kwh = total(current)! - total(previous)!;
    if (kwh < 0) continue;

    points.push({
      from: previous.read_at,
      to: current.read_at,
      days,
      kwh,
      perMonth: (kwh / days) * DAYS_PER_MONTH,
    });
  }

  return points;
}
