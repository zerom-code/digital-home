/**
 * Замер вместо оценки.
 *
 * Весь остальной расчёт в calc.ts — это оценка: мощность из справочника, часы
 * работы на глаз, отсюда «≈» у каждой цифры. Розетка с ваттметром даёт то,
 * чего оценка дать не может, — факт. Поэтому там, где замер есть, он
 * **отменяет** оценку, а не соседствует с ней.
 *
 * Здесь только чистые функции: их можно прогнать без базы и без устройства,
 * и именно они решают, какое число человек увидит.
 */

import { DAYS_PER_MONTH } from './calc';

/**
 * Сколько должно пройти от начала месяца, чтобы пересчёт на месяц имел смысл.
 *
 * Первые часы месяца дают дикий разброс: чайник, вскипевший в 00:30 первого
 * числа, при делении на «прошло полчаса» превращается в киловатты в месяц.
 * Сутки — минимум, на котором суточный цикл техники уже усреднён.
 */
export const MIN_ELAPSED_DAYS = 1;

/**
 * Через сколько молчания считаем, что мост отвалился.
 *
 * Мост шлёт heartbeat раз в минуту, поэтому десять минут тишины — это уже не
 * дрожание сети, а «выключили Pi» или «пропал интернет». Показывать в этот
 * момент последнюю известную мощность как текущую нельзя: человек решит, что
 * прибор работает.
 */
export const OFFLINE_AFTER_MS = 10 * 60 * 1000;

/**
 * Расход за месяц по замеру, кВт·ч.
 *
 * Розетка отдаёт накопленный расход **с начала календарного месяца**. Первого
 * числа это почти ноль, тридцатого — почти полный месяц. Сравнивать это
 * напрямую с оценкой на полный месяц нельзя: пятого числа любой прибор
 * покажется в шесть раз экономнее, чем он есть, и сверка радостно сообщит,
 * что расчёт завышен. Поэтому пересчитываем на полный месяц.
 *
 * Месяц берём средний (как в calc.ts), а не календарный: сравнивать замер
 * нужно ровно с той оценкой, что считает calc.ts, иначе к разнице добавится
 * пара процентов из-за разной длины февраля и августа.
 */
export function projectedMonthlyKwh(monthWh: number | null, now: Date): number | null {
  if (monthWh === null || !Number.isFinite(monthWh) || monthWh < 0) return null;

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const elapsedDays = (now.getTime() - monthStart.getTime()) / 86_400_000;

  if (!Number.isFinite(elapsedDays) || elapsedDays < MIN_ELAPSED_DAYS) return null;

  return (monthWh / 1000 / elapsedDays) * DAYS_PER_MONTH;
}

/** На связи ли мост: последний замер не слишком давно. */
export function isOnline(lastSeenAt: string | null, now: Date): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(seen)) return false;
  return now.getTime() - seen <= OFFLINE_AFTER_MS;
}

/**
 * Мощность, которую honest показать как текущую.
 *
 * Отвалившийся мост отдаёт null, а не последнее известное значение: показать
 * вчерашние 2 кВт как «сейчас» — это соврать в самом заметном месте экрана.
 */
export function livePowerW(
  plug: { last_power_w: number | null; last_seen_at: string | null },
  now: Date
): number | null {
  if (!isOnline(plug.last_seen_at, now)) return null;
  if (plug.last_power_w === null || !Number.isFinite(plug.last_power_w)) return null;
  return plug.last_power_w;
}

export interface DailyPoint {
  day: string;
  kwh: number;
}

/**
 * Ряд «расход по дням» для графика.
 *
 * База отдаёт ватт-часы (plug_daily_energy), человек мыслит киловатт-часами.
 * Дни без замеров не выдумываем — пропуск в графике честнее нарисованного
 * нуля, который читается как «прибор не работал».
 */
export function dailyPoints(rows: { day: string; wh: number | null }[]): DailyPoint[] {
  return rows
    .filter((row): row is { day: string; wh: number } =>
      typeof row.wh === 'number' && Number.isFinite(row.wh) && row.wh >= 0
    )
    .map((row) => ({ day: row.day, kwh: row.wh / 1000 }));
}
