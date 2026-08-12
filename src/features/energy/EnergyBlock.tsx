import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Chip, InviteBlock } from '@/components/ui';
import { useCategories } from '@/features/home/useHomeData';
import { estimate, monthlyCost } from '@/lib/energy/calc';
import { livePowerW, projectedMonthlyKwh } from '@/lib/energy/measured';
import { profileForItem, useEnergyProfiles, useTariff } from './useEnergy';
import { usePlugs } from './usePlugs';
import { EnergySheet } from './EnergySheet';

interface Props {
  itemId: string;
  householdId: string | null;
  categoryId: string | null;
  canWrite: boolean;
}

/**
 * Блок «Энергия» в карточке вещи.
 *
 * Два источника числа, и между ними есть иерархия. Оценка по справочнику
 * работает сразу и ничего не требует — с неё всё начинается. Замер с розетки
 * точнее и потому **заменяет** оценку, как только появляется: сравнивать их
 * между собой полезно один раз, чтобы понять, насколько врал справочник
 * (docs/03-energy.md).
 */
export function EnergyBlock({ itemId, householdId, categoryId, canWrite }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const profiles = useEnergyProfiles(householdId);
  const categories = useCategories();
  const tariff = useTariff(householdId);
  const plugs = usePlugs(householdId);

  const profile = profiles.data?.find((row) => row.item_id === itemId);
  const category = categoryId ? categories.data?.find((row) => row.id === categoryId) : undefined;
  const rate = tariff.data ?? { kind: 'single' as const, rate_day: null };

  const resolved = profileForItem(profile, category);
  const guess = resolved ? estimate(resolved.input, rate, new Date().getMonth() + 1) : null;

  const now = new Date();
  const plug = plugs.data?.find((row) => row.item_id === itemId) ?? null;
  const measuredKwh = plug ? projectedMonthlyKwh(plug.month_wh, now) : null;
  const live = plug ? livePowerW(plug, now) : null;

  // Замер важнее оценки, но и оценка лучше пустоты
  const shownKwh = measuredKwh ?? guess?.kwh ?? null;
  const shownCost =
    measuredKwh !== null
      ? monthlyCost(measuredKwh, rate, guess?.nightShare ?? 0)
      : (guess?.cost ?? null);

  const sheet = householdId && (
    <EnergySheet
      open={editing}
      onClose={() => setEditing(false)}
      itemId={itemId}
      householdId={householdId}
      profile={profile}
      category={category}
    />
  );

  // Ни замера, ни своих значений, ни типовых у категории — предлагаем
  // заполнить, а не показываем карточку с прочерками
  if (shownKwh === null) {
    return (
      <>
        <InviteBlock
          icon="⚡"
          title={t('item.energyEmptyTitle')}
          text={t('item.energyEmptyText')}
          action={
            canWrite && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('energy.setUp')}
              </Button>
            )
          }
        />
        {sheet}
      </>
    );
  }

  const measured = measuredKwh !== null;
  const approx = measured ? '' : '≈ ';

  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⚡</span>
        <h3 className="font-semibold text-ink">{t('energy.title')}</h3>
        {measured && <Chip tone="accent">🔌 {t('energy.byMeasurement')}</Chip>}
      </div>

      <p className="text-2xl font-extrabold tracking-tight text-ink">
        {shownCost === null
          ? `${approx}${t('energy.kwhPerMonth', { kwh: shownKwh.toFixed(1) })}`
          : `${approx}${t('energy.perMonth', { cost: Math.round(shownCost).toLocaleString('ru-UA') })}`}
      </p>
      <p className="text-sm text-ink-3">
        {approx}
        {t('energy.kwhPerMonth', { kwh: shownKwh.toFixed(1) })}
        {!measured && resolved?.fromCategory && ` · ${t('energy.fromCategory')}`}
      </p>

      {/* Мгновенная мощность: то, ради чего розетку и ставили */}
      {plug && (
        <p className="mt-1 text-sm">
          {live === null ? (
            <span className="text-ink-3">{t('plugs.offline')}</span>
          ) : (
            <span className="text-accent-ink">
              {t('plugs.rightNow', { watts: Math.round(live).toLocaleString('ru-UA') })}
            </span>
          )}
        </p>
      )}

      {/* Насколько врал справочник — это видно только когда есть оба числа.
          Проверка guess отдельно от guess.kwh не лишняя: сужение типа через
          `guess?.kwh != null` компилятор на сам guess не переносит */}
      {measured && guess !== null && guess.kwh !== null && (
        <p className="mt-1 text-xs text-ink-3">
          {t('energy.estimateWas', { kwh: guess.kwh.toFixed(1) })}
        </p>
      )}

      {canWrite && (
        <div className="mt-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('energy.setUp')}
          </Button>
        </div>
      )}

      {sheet}
    </Card>
  );
}
