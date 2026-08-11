import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, InviteBlock } from '@/components/ui';
import { useCategories } from '@/features/home/useHomeData';
import { estimate } from '@/lib/energy/calc';
import { profileForItem, useEnergyProfiles, useTariff } from './useEnergy';
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
 * Считает сразу, как только у категории есть типовые значения: человек видит
 * пользу до того, как что-то заполнил, и уже потом решает, уточнять ли. Это и
 * есть режим `typical` (docs/03-energy.md) — лестница, по которой поднимаются
 * добровольно.
 */
export function EnergyBlock({ itemId, householdId, categoryId, canWrite }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  const profiles = useEnergyProfiles(householdId);
  const categories = useCategories();
  const tariff = useTariff(householdId);

  const profile = profiles.data?.find((row) => row.item_id === itemId);
  const category = categoryId ? categories.data?.find((row) => row.id === categoryId) : undefined;

  const resolved = profileForItem(profile, category);
  const result = resolved
    ? estimate(resolved.input, tariff.data ?? { kind: 'single', rate_day: null }, new Date().getMonth() + 1)
    : null;

  // Ни своих значений, ни типовых у категории — предлагаем заполнить, а не
  // показываем пустую карточку с прочерками
  if (!result || result.kwh === null) {
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
        {householdId && (
          <EnergySheet
            open={editing}
            onClose={() => setEditing(false)}
            itemId={itemId}
            householdId={householdId}
            profile={profile}
            category={category}
          />
        )}
      </>
    );
  }

  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⚡</span>
        <h3 className="font-semibold text-ink">{t('energy.title')}</h3>
      </div>

      <p className="text-2xl font-extrabold tracking-tight text-ink">
        {result.cost === null
          ? t('energy.kwhPerMonth', { kwh: result.kwh.toFixed(1) })
          : t('energy.perMonth', { cost: Math.round(result.cost).toLocaleString('ru-UA') })}
      </p>
      <p className="text-sm text-ink-3">
        {t('energy.kwhPerMonth', { kwh: result.kwh.toFixed(1) })}
        {resolved.fromCategory && ` · ${t('energy.fromCategory')}`}
      </p>

      {canWrite && (
        <div className="mt-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('energy.setUp')}
          </Button>
        </div>
      )}

      {householdId && (
        <EnergySheet
          open={editing}
          onClose={() => setEditing(false)}
          itemId={itemId}
          householdId={householdId}
          profile={profile}
          category={category}
        />
      )}
    </Card>
  );
}
