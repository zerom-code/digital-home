import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useCategories, useItems } from '@/features/home/useHomeData';
import { PageHeader } from '@/app/PageHeader';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';
import { estimate, monthlyCost, totals } from '@/lib/energy/calc';
import type { Estimate } from '@/lib/energy/calc';
import { reconcile } from '@/lib/energy/reconcile';
import { usageSeries } from '@/lib/energy/history';
import { projectedMonthlyKwh } from '@/lib/energy/measured';
import { profileForItem, useEnergyProfiles, useMeters, useMeterUsage, useReadings, useTariff } from './useEnergy';
import { usePlugs } from './usePlugs';
import { TariffSheet } from './TariffSheet';
import { MeterSheet } from './MeterSheet';
import { PlugsCard } from './PlugsCard';
import { UsageChart } from './UsageChart';

/** Гривны без копеек: точность тут мнимая, а короткое число читается легче. */
const money = (value: number) => Math.round(value).toLocaleString('ru-UA');
const kwh = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value).toString());

/**
 * Экран «Энергия».
 *
 * Отвечает на один вопрос: во что обходится техника в месяц и сходится ли это
 * со счётчиком. Всё оценочное помечено «≈» — приложение считает, а не
 * выставляет счёт (docs/03-energy.md).
 */
export function EnergyScreen() {
  const { t } = useTranslation();
  const household = useActiveHousehold();
  const householdId = household.householdId;

  const items = useItems(householdId);
  const categories = useCategories();
  const profiles = useEnergyProfiles(householdId);
  const tariff = useTariff(householdId);
  const meters = useMeters(householdId);
  const plugs = usePlugs(householdId);

  const [editingTariff, setEditingTariff] = useState(false);
  const [editingMeter, setEditingMeter] = useState(false);

  const meter = meters.data?.[0] ?? null;
  const usage = useMeterUsage(meter?.id ?? null);
  const readings = useReadings(meter?.id ?? null);

  const month = new Date().getMonth() + 1;

  const rows = useMemo(() => {
    const byItem = new Map((profiles.data ?? []).map((p) => [p.item_id, p]));
    const byCategory = new Map((categories.data ?? []).map((c) => [c.id, c]));
    const rate = tariff.data ?? { kind: 'single' as const, rate_day: null };
    const now = new Date();

    // Замер отменяет оценку: если в вещь воткнута розетка с ваттметром, её
    // расход больше не нужно угадывать по справочнику
    const measuredByItem = new Map<string, number>();
    for (const plug of plugs.data ?? []) {
      if (!plug.item_id) continue;
      const projected = projectedMonthlyKwh(plug.month_wh, now);
      if (projected !== null) measuredByItem.set(plug.item_id, projected);
    }

    return (items.data ?? []).map((item) => {
      const resolved = profileForItem(
        byItem.get(item.id),
        item.category_id ? byCategory.get(item.category_id) : undefined
      );
      const guess: Estimate = resolved
        ? estimate(resolved.input, rate, month)
        : { kwh: null, cost: null, nightShare: 0 };

      const measured = measuredByItem.get(item.id);
      if (measured === undefined) {
        return {
          item,
          estimate: guess,
          fromCategory: resolved?.fromCategory ?? false,
          measured: false,
        };
      }

      // Ночную долю берём из оценки: розетка знает, сколько съедено, но не
      // знает когда, а двузонный тариф зависит именно от времени
      return {
        item,
        estimate: {
          kwh: measured,
          cost: monthlyCost(measured, rate, guess.nightShare),
          nightShare: guess.nightShare,
        } satisfies Estimate,
        fromCategory: false,
        measured: true,
      };
    });
  }, [items.data, profiles.data, categories.data, tariff.data, plugs.data, month]);

  const total = useMemo(() => totals(rows.map((row) => row.estimate)), [rows]);

  // Расход по счётчику приходит уже приведённым к месяцу, так что сравнивать
  // можно напрямую
  const check = reconcile(total.counted > 0 ? total.kwh : null, usage.data ?? null);
  const series = usageSeries(readings.data ?? []);

  if (items.isLoading || categories.isLoading) {
    return <Spinner label={t('common.loading')} />;
  }

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={t('energy.title')} />
        <EmptyState icon="⚡" title={t('energy.emptyTitle')} text={t('energy.emptyText')} />
      </>
    );
  }

  const sorted = [...rows].sort((a, b) => (b.estimate.kwh ?? -1) - (a.estimate.kwh ?? -1));

  return (
    <>
      <PageHeader title={t('energy.title')} />

      <div className="flex flex-col gap-4 px-4 pb-8 pt-4">
        {/* Итог: крупно и первым — ради этой цифры сюда и заходят */}
        <Card className="flex flex-col items-center gap-1 p-5 text-center">
          <p className="text-4xl font-extrabold tracking-tight text-ink">
            {total.cost > 0 ? t('energy.perMonth', { cost: money(total.cost) }) : '—'}
          </p>
          <p className="text-ink-2">{t('energy.kwhPerMonth', { kwh: kwh(total.kwh) })}</p>

          {total.unknown > 0 && (
            // Молчать о непосчитанном нельзя: иначе итог выглядит полным,
            // а он неполный
            <p className="mt-2 text-sm text-ink-3">
              {t('energy.unknownCount', { count: total.unknown })} · {t('energy.unknownHint')}
            </p>
          )}
        </Card>

        <button
          type="button"
          onClick={() => setEditingTariff(true)}
          className="flex min-h-12 items-center justify-between rounded-xl border border-line bg-surface px-4 text-left"
        >
          <span className="text-ink-2">{t('energy.tariff')}</span>
          <span className="font-semibold text-ink">
            {tariff.data?.rate_day
              ? `${tariff.data.rate_day} грн${tariff.data.kind === 'two_zone' ? ' · день/ночь' : ''}`
              : t('common.notSet')}
          </span>
        </button>

        {/* Сверка со счётчиком */}
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-bold text-ink">{t('energy.checkTitle')}</h2>

          {check.verdict === 'no_data' ? (
            <>
              <p className="text-sm text-ink-2">{t('energy.readingsNeedTwo')}</p>
              <Button variant="secondary" onClick={() => setEditingMeter(true)}>
                {meter ? t('energy.readingAdd') : t('energy.meterAdd')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-4">
                <Figure label={t('energy.checkEstimated')} value={kwh(check.estimated!)} />
                <Figure label={t('energy.checkActual')} value={kwh(check.actual!)} />
              </div>

              <div
                className={[
                  'rounded-xl px-4 py-3 text-sm',
                  check.verdict === 'close' ? 'bg-accent-soft text-accent-ink' : 'bg-warn-soft text-warn',
                ].join(' ')}
              >
                <p className="font-semibold">{t(`energy.verdict${cap(check.verdict)}`)}</p>
                <p className="mt-1">{t(`energy.verdict${cap(check.verdict)}Hint`)}</p>
                {check.verdict !== 'close' && (
                  <p className="mt-1 opacity-80">
                    {t('energy.diff', { kwh: kwh(Math.abs(check.diffKwh!)) })}
                  </p>
                )}
              </div>

              {/* График появляется сам, когда показаний накопилось на ряд:
                  просить «добавьте ещё» на пустом месте незачем */}
              <UsageChart points={series} estimated={total.kwh} />

              <Button variant="ghost" onClick={() => setEditingMeter(true)}>
                {t('energy.readingAdd')}
              </Button>
            </>
          )}
        </Card>

        {/* Розетки с ваттметром: единственные числа на экране без «≈» */}
        <PlugsCard householdId={householdId} items={items.data ?? []} canWrite={household.canWrite} />

        {/* Разбивка по вещам: самые прожорливые сверху — с них и начинают */}
        <h2 className="mt-2 font-bold text-ink">{t('energy.byItem')}</h2>
        <Card className="divide-y divide-line">
          {sorted.map(({ item, estimate: value, fromCategory, measured }) => (
            <Link
              key={item.id}
              to={`/item/${item.id}`}
              className="flex items-center gap-3 px-4 py-3 active:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{item.name}</span>
                {measured ? (
                  <span className="text-xs text-accent-ink">🔌 {t('energy.byMeasurement')}</span>
                ) : (
                  fromCategory &&
                  value.kwh !== null && (
                    <span className="text-xs text-ink-3">{t('energy.fromCategory')}</span>
                  )
                )}
              </span>
              <span className="shrink-0 text-right">
                {value.kwh === null ? (
                  <span className="text-sm text-ink-3">{t('energy.noData')}</span>
                ) : (
                  <>
                    {/* «≈» ставим только у оценки: у замера его быть не должно,
                        иначе стирается разница между «посчитали» и «померили» */}
                    <span className="block font-semibold text-ink">
                      {value.cost === null
                        ? '—'
                        : `${measured ? '' : '≈ '}${money(value.cost)} грн`}
                    </span>
                    <span className="text-xs text-ink-3">
                      {measured ? '' : '≈ '}
                      {kwh(value.kwh)} кВт·ч
                    </span>
                  </>
                )}
              </span>
            </Link>
          ))}
        </Card>
      </div>

      <TariffSheet
        open={editingTariff}
        onClose={() => setEditingTariff(false)}
        tariff={tariff.data ?? null}
        householdId={householdId}
      />
      <MeterSheet
        open={editingMeter}
        onClose={() => setEditingMeter(false)}
        meter={meter}
        householdId={householdId}
      />
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1">
      <p className="text-sm text-ink-3">{label}</p>
      <p className="text-xl font-bold text-ink">≈ {value} кВт·ч</p>
    </div>
  );
}

/** 'close' → 'Close': ключи переводов собираются из вердикта. */
function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
