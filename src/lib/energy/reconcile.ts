/**
 * Сверка расчёта с показаниями счётчика.
 *
 * Смысл экрана «Энергия» не в том, чтобы угадать счёт до копейки — угадать
 * его нельзя. Смысл в том, чтобы человек видел, **насколько** расчёт сходится
 * с реальностью, и понимал, что с расхождением делать. Поэтому вердикт всегда
 * сопровождается действием, а не просто цифрой (docs/06-roadmap.md, критерий
 * готовности фазы 3).
 */

/**
 * До какого расхождения считаем, что сошлось.
 *
 * 15 % — не подогнанное число, а честная граница возможностей модели:
 * duty_cycle холодильника, часы работы телевизора и доля ночного тарифа
 * задаются на глаз. Обещать точность выше — врать.
 */
export const CLOSE_ENOUGH = 0.15;

export type Verdict =
  /** Сверять не с чем: нет расчёта, нет показаний или их меньше двух. */
  | 'no_data'
  /** Расчёт сходится с фактом в пределах погрешности модели. */
  | 'close'
  /** Расчёт меньше факта: что-то потребляет и не внесено в приложение. */
  | 'under'
  /** Расчёт больше факта: где-то завышены параметры. */
  | 'over';

export interface Reconciliation {
  verdict: Verdict;
  /** Расчёт по вещам, кВт·ч/мес. */
  estimated: number | null;
  /** Факт по счётчику, кВт·ч/мес. */
  actual: number | null;
  /** Факт минус расчёт, кВт·ч/мес. Положительное — расчёт занижен. */
  diffKwh: number | null;
  /** Доля расхождения от факта, 0..1. */
  diffShare: number | null;
}

export function reconcile(
  estimated: number | null,
  actual: number | null
): Reconciliation {
  const empty: Reconciliation = {
    verdict: 'no_data',
    estimated,
    actual,
    diffKwh: null,
    diffShare: null,
  };

  if (estimated === null || actual === null) return empty;
  // Нулевой факт означает, что показания есть, но расход между ними нулевой:
  // делить на него нельзя, да и сверять нечего
  if (!Number.isFinite(estimated) || !Number.isFinite(actual) || actual <= 0) return empty;

  const diffKwh = actual - estimated;
  const diffShare = Math.abs(diffKwh) / actual;

  if (diffShare <= CLOSE_ENOUGH) {
    return { verdict: 'close', estimated, actual, diffKwh, diffShare };
  }

  return {
    verdict: diffKwh > 0 ? 'under' : 'over',
    estimated,
    actual,
    diffKwh,
    diffShare,
  };
}
