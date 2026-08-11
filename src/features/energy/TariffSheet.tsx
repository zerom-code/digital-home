import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Sheet, useToast } from '@/components/ui';
import { NIGHT_RATE_SHARE } from '@/lib/energy/calc';
import type { Tariff, TariffKind } from '@/lib/supabase/types';
import { useSaveTariff } from './useEnergy';

interface Props {
  open: boolean;
  onClose: () => void;
  tariff: Tariff | null;
  householdId: string | null;
}

/**
 * Правка тарифа.
 *
 * Ставку менять придётся: постановления выходят регулярно. Поэтому здесь
 * честно предупреждаем, что прошлые месяцы останутся посчитанными по старой
 * цене — это не побочный эффект, а то, ради чего у тарифов есть история
 * (docs/03-energy.md).
 */
export function TariffSheet({ open, onClose, tariff, householdId }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveTariff(householdId);

  const [kind, setKind] = useState<TariffKind>('single');
  const [day, setDay] = useState('');
  const [night, setNight] = useState('');

  // Открыли лист — показываем то, что сейчас в базе, а не то, что осталось
  // от прошлого открытия
  useEffect(() => {
    if (!open) return;
    setKind(tariff?.kind ?? 'single');
    setDay(tariff?.rate_day != null ? String(tariff.rate_day) : '');
    setNight(tariff?.rate_night != null ? String(tariff.rate_night) : '');
  }, [open, tariff]);

  const dayRate = Number(day.replace(',', '.'));
  const valid = Number.isFinite(dayRate) && dayRate > 0;

  // Подсказка, а не подстановка: человек видит, что получится, но число
  // остаётся его
  const suggestedNight = valid ? (dayRate * NIGHT_RATE_SHARE).toFixed(2) : '';

  return (
    <Sheet open={open} onClose={onClose} title={t('energy.tariff')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid) return;

          const nightRate = Number(night.replace(',', '.'));
          await save.mutateAsync({
            id: tariff?.id,
            kind,
            rate_day: dayRate,
            rate_night:
              kind === 'two_zone' && Number.isFinite(nightRate) && nightRate > 0
                ? nightRate
                : null,
          });
          toast.show(t('energy.tariffSaved'));
          onClose();
        }}
      >
        <Select
          label={t('energy.tariff')}
          value={kind}
          onChange={(event) => setKind(event.target.value as TariffKind)}
        >
          <option value="single">{t('energy.tariffSingle')}</option>
          <option value="two_zone">{t('energy.tariffTwoZone')}</option>
        </Select>

        <Input
          label={t('energy.rateDay')}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />

        {kind === 'two_zone' && (
          <>
            <Input
              label={t('energy.rateNight')}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={night}
              placeholder={suggestedNight}
              onChange={(event) => setNight(event.target.value)}
              hint={t('energy.rateNightHint')}
            />
            <p className="text-sm text-ink-3">
              {t('energy.nightWindow', {
                start: (tariff?.night_start ?? '23:00').slice(0, 5),
                end: (tariff?.night_end ?? '07:00').slice(0, 5),
              })}
            </p>
          </>
        )}

        {tariff && (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-3">
            {t('energy.tariffHistoryNote')}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={!valid} loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  );
}
