import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Sheet, useToast } from '@/components/ui';
import type { EnergyMode, EnergyProfile, ItemCategory, LabelUnit } from '@/lib/supabase/types';
import { profileForItem, useSaveEnergyProfile } from './useEnergy';

interface Props {
  open: boolean;
  onClose: () => void;
  itemId: string;
  householdId: string | null;
  profile: EnergyProfile | undefined;
  category: ItemCategory | undefined;
}

/** Пустая строка вместо нуля: незаполненное поле должно выглядеть пустым. */
const str = (value: number | null | undefined) => (value == null ? '' : String(value));
const numOrNull = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return value.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
};

/**
 * Энергопрофиль вещи: четыре режима ввода.
 *
 * Порядок режимов в списке — от ленивого к точному, и по умолчанию выбран
 * самый ленивый. Спросить «сколько ватт потребляет твой холодильник» значит
 * потерять человека: он не знает и выяснять не пойдёт (docs/03-energy.md).
 * Поэтому лестница, по которой поднимаются добровольно.
 */
export function EnergySheet({ open, onClose, itemId, householdId, profile, category }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSaveEnergyProfile(householdId);

  const [mode, setMode] = useState<EnergyMode>('typical');
  const [form, setForm] = useState({
    power_w: '',
    standby_w: '',
    duty_cycle: '',
    hours_per_day: '',
    kwh_per_cycle: '',
    cycles_per_week: '',
    label_value: '',
    night_share: '',
  });
  const [labelUnit, setLabelUnit] = useState<LabelUnit>('kwh_year');

  // Ещё не заполнявшуюся вещь открываем на типовых значениях категории:
  // человеку остаётся поправить, а не набрать всё с нуля
  useEffect(() => {
    if (!open) return;
    const resolved = profileForItem(profile, category);
    const input = resolved?.input;

    setMode(input?.mode ?? 'typical');
    setLabelUnit(input?.label_unit ?? category?.label_unit ?? 'kwh_year');
    setForm({
      power_w: str(input?.power_w),
      standby_w: str(input?.standby_w),
      duty_cycle: str(input?.duty_cycle),
      hours_per_day: str(input?.hours_per_day),
      kwh_per_cycle: str(input?.kwh_per_cycle),
      cycles_per_week: str(input?.cycles_per_week),
      label_value: str(input?.label_value),
      night_share: str(profile?.night_share),
    });
  }, [open, profile, category]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <Sheet open={open} onClose={onClose} title={t('energy.title')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          await save.mutateAsync({
            itemId,
            patch: {
              mode,
              power_w: numOrNull(form.power_w),
              standby_w: numOrNull(form.standby_w),
              duty_cycle: numOrNull(form.duty_cycle),
              hours_per_day: numOrNull(form.hours_per_day),
              kwh_per_cycle: numOrNull(form.kwh_per_cycle),
              cycles_per_week: numOrNull(form.cycles_per_week),
              label_value: numOrNull(form.label_value),
              label_unit: mode === 'label' ? labelUnit : null,
              night_share: numOrNull(form.night_share),
              // Раз человек открыл этот лист и сохранил — значения теперь его,
              // а не взятые из справочника
              source: 'user',
            },
          });
          toast.show(t('common.saved'));
          onClose();
        }}
      >
        <Select
          label={t('energy.mode')}
          value={mode}
          onChange={(event) => setMode(event.target.value as EnergyMode)}
          hint={mode === 'typical' ? t('energy.modeTypicalHint') : undefined}
        >
          <option value="typical">{t('energy.modeTypical')}</option>
          <option value="label">{t('energy.modeLabel')}</option>
          <option value="power_hours">{t('energy.modePowerHours')}</option>
          <option value="per_cycle">{t('energy.modePerCycle')}</option>
        </Select>

        {mode === 'typical' && (
          <>
            <Input label={t('energy.powerW')} type="number" inputMode="decimal" min={0}
              value={form.power_w} onChange={set('power_w')} />
            <Input label={t('energy.dutyCycle')} type="number" inputMode="decimal"
              min={0} max={1} step="0.05" value={form.duty_cycle} onChange={set('duty_cycle')}
              hint={t('energy.dutyCycleHint')} />
          </>
        )}

        {mode === 'label' && (
          <>
            <Select
              label={t('energy.labelUnitHint')}
              value={labelUnit}
              onChange={(event) => setLabelUnit(event.target.value as LabelUnit)}
            >
              <option value="kwh_year">{t('energy.labelUnitYear')}</option>
              <option value="kwh_100cycles">{t('energy.labelUnit100')}</option>
              <option value="kwh_1000h">{t('energy.labelUnit1000h')}</option>
            </Select>
            <Input label={t('energy.labelValue')} type="number" inputMode="decimal" min={0}
              value={form.label_value} onChange={set('label_value')} />

            {/* Наклейке на 100 циклов нужны циклы, на 1000 часов — часы:
                без них пересчитать в месяц нечем */}
            {labelUnit === 'kwh_100cycles' && (
              <Input label={t('energy.cyclesPerWeek')} type="number" inputMode="decimal" min={0}
                value={form.cycles_per_week} onChange={set('cycles_per_week')} />
            )}
            {labelUnit === 'kwh_1000h' && (
              <Input label={t('energy.hoursPerDay')} type="number" inputMode="decimal"
                min={0} max={24} value={form.hours_per_day} onChange={set('hours_per_day')} />
            )}
          </>
        )}

        {mode === 'power_hours' && (
          <>
            <Input label={t('energy.powerW')} type="number" inputMode="decimal" min={0}
              value={form.power_w} onChange={set('power_w')} />
            <Input label={t('energy.hoursPerDay')} type="number" inputMode="decimal"
              min={0} max={24} value={form.hours_per_day} onChange={set('hours_per_day')} />
            <Input label={t('energy.standbyW')} type="number" inputMode="decimal" min={0}
              value={form.standby_w} onChange={set('standby_w')} />
          </>
        )}

        {mode === 'per_cycle' && (
          <>
            <Input label={t('energy.kwhPerCycle')} type="number" inputMode="decimal" min={0}
              step="0.1" value={form.kwh_per_cycle} onChange={set('kwh_per_cycle')} />
            <Input label={t('energy.cyclesPerWeek')} type="number" inputMode="decimal" min={0}
              value={form.cycles_per_week} onChange={set('cycles_per_week')} />
          </>
        )}

        <Input label={t('energy.nightShare')} type="number" inputMode="decimal"
          min={0} max={1} step="0.05" value={form.night_share} onChange={set('night_share')}
          hint={t('energy.nightShareHint')} />

        <Button type="submit" size="lg" block loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  );
}
