import { useTranslation } from 'react-i18next';

import type { UsagePoint } from '@/lib/energy/history';

interface Props {
  points: UsagePoint[];
  /** Расчёт по вещам — линия для сравнения. */
  estimated?: number | null;
}

/**
 * График расхода по счётчику.
 *
 * Столбики нарисованы вручную на SVG, без библиотеки: точек здесь единицы,
 * подписи русские, а любая библиотека графиков весит больше всего остального
 * экрана вместе взятого (ADR-013 — тот же довод, что и про UI-кит).
 *
 * Высота столбика — расход, приведённый к месяцу, а не сырой за период:
 * показания снимают когда придётся, и без приведения неделя рядом с месяцем
 * выглядела бы «экономией» на пустом месте.
 */
export function UsageChart({ points, estimated }: Props) {
  const { t } = useTranslation();

  if (points.length === 0) return null;

  const visible = points.slice(-8);
  const peak = Math.max(...visible.map((point) => point.perMonth), estimated ?? 0);
  if (peak <= 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-32 items-end gap-1.5">
        {visible.map((point) => {
          const height = Math.max(2, (point.perMonth / peak) * 100);
          return (
            <div key={point.to} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-ink-3">{Math.round(point.perMonth)}</span>
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${height}%` }}
                role="img"
                aria-label={t('energy.chartBar', {
                  date: new Date(point.to).toLocaleDateString('ru-UA'),
                  kwh: Math.round(point.perMonth),
                })}
              />
            </div>
          );
        })}
      </div>

      <div className="flex gap-1.5">
        {visible.map((point) => (
          <span key={point.to} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-3">
            {new Date(point.to).toLocaleDateString('ru-UA', { day: 'numeric', month: 'short' })}
          </span>
        ))}
      </div>

      <p className="text-xs text-ink-3">{t('energy.chartHint')}</p>
    </div>
  );
}
