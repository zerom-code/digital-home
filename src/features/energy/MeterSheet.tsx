import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Sheet, useToast } from '@/components/ui';
import type { Meter } from '@/lib/supabase/types';
import { useAddMeter, useAddReading, useReadings } from './useEnergy';

interface Props {
  open: boolean;
  onClose: () => void;
  meter: Meter | null;
  householdId: string | null;
}

/**
 * Счётчик и показания.
 *
 * Счётчик заводится молча при первом внесении показаний: спрашивать про
 * серийный номер и число зон раньше, чем человек увидел пользу, — верный
 * способ до пользы не дойти (docs/04-ux.md).
 */
export function MeterSheet({ open, onClose, meter, householdId }: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  const addMeter = useAddMeter(householdId);
  const addReading = useAddReading(householdId);
  const readings = useReadings(meter?.id ?? null);

  const [day, setDay] = useState('');
  const [night, setNight] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDay('');
    setNight('');
  }, [open]);

  const dayValue = Number(day.replace(',', '.'));
  const valid = Number.isFinite(dayValue) && day.trim() !== '';
  const twoZone = (meter?.zones ?? 1) > 1 || night.trim() !== '';

  return (
    <Sheet open={open} onClose={onClose} title={t('energy.meterReading')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid) return;
          setBusy(true);
          try {
            // Счётчика ещё нет — заводим на лету, чтобы показания было куда
            // класть. Его id берём из ответа, а не из пропа: тот обновится
            // только на следующем рендере, а показания нужны сейчас
            const meterId = meter
              ? meter.id
              : await addMeter.mutateAsync({ zones: night.trim() ? 2 : 1 });

            const nightValue = Number(night.replace(',', '.'));
            await addReading.mutateAsync({
              meterId,
              value_day: dayValue,
              value_night: night.trim() && Number.isFinite(nightValue) ? nightValue : null,
            });
            toast.show(t('energy.readingSaved'));
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          label={twoZone ? t('energy.readingDay') : t('energy.meterReading')}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          autoFocus
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />

        <Input
          label={t('energy.readingNight')}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={night}
          onChange={(event) => setNight(event.target.value)}
          hint={t('energy.nightShareHint')}
        />

        {/* Одного показания мало: расход — это разница между двумя */}
        {(readings.data?.length ?? 0) < 1 && (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-3">
            {t('energy.readingsNeedTwo')}
          </p>
        )}

        {(readings.data?.length ?? 0) > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-ink-3">
            {readings.data!.slice(0, 5).map((reading) => (
              <li key={reading.id} className="flex justify-between">
                <span>{new Date(reading.read_at).toLocaleDateString('ru-UA')}</span>
                <span className="text-ink-2">
                  {reading.value_day ?? '—'}
                  {reading.value_night != null && ` / ${reading.value_night}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Button type="submit" size="lg" block disabled={!valid} loading={busy}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  );
}
