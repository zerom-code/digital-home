import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { keys } from '@/lib/query/client';
import type {
  EnergyProfile,
  ItemCategory,
  Meter,
  MeterReading,
  Tariff,
} from '@/lib/supabase/types';
import type { EnergyInput } from '@/lib/energy/calc';

/* ─── Тариф ──────────────────────────────────────────────────────────────── */

/**
 * Действующий тариф семьи.
 *
 * Действующий — тот, у которого не проставлен `effective_to`. Старые записи
 * остаются в таблице: по ним считаются прошлые месяцы (docs/03-energy.md).
 */
export function useTariff(householdId: string | null) {
  return useQuery({
    queryKey: keys.tariff(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Tariff | null> => {
      const { data, error } = await supabase
        .from('tariffs')
        .select('*')
        .eq('household_id', householdId!)
        .is('effective_to', null)
        .order('effective_from', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/**
 * Правка тарифа.
 *
 * Смена ставки — это **новая запись**, а не правка старой: иначе прошлые
 * месяцы задним числом пересчитались бы по сегодняшней цене. Старая запись
 * закрывается вчерашним днём, новая начинается сегодня. Всё остальное
 * (название, часы ночного окна) правится на месте — это не история цен.
 */
export function useSaveTariff(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Partial<Tariff> & { id?: string }) => {
      if (!householdId) throw new Error('Нет активного дома');

      const ratesChanged =
        patch.rate_day !== undefined ||
        patch.rate_night !== undefined ||
        patch.kind !== undefined;

      if (patch.id && ratesChanged) {
        const today = new Date().toISOString().slice(0, 10);

        const { data: current, error: readError } = await supabase
          .from('tariffs')
          .select('*')
          .eq('id', patch.id)
          .single();
        if (readError) throw readError;

        // Закрываем вчерашним днём: два тарифа не должны действовать в один
        // и тот же день
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const { error: closeError } = await supabase
          .from('tariffs')
          .update({ effective_to: yesterday })
          .eq('id', patch.id);
        if (closeError) throw closeError;

        const { error: insertError } = await supabase.from('tariffs').insert({
          household_id: householdId,
          name: patch.name ?? current.name,
          kind: patch.kind ?? current.kind,
          rate_day: patch.rate_day ?? current.rate_day,
          rate_night: patch.rate_night ?? current.rate_night,
          night_start: patch.night_start ?? current.night_start,
          night_end: patch.night_end ?? current.night_end,
          currency: current.currency,
          effective_from: today,
        });
        if (insertError) throw insertError;
        return;
      }

      if (patch.id) {
        const { id, ...rest } = patch;
        const { error } = await supabase.from('tariffs').update(rest).eq('id', id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('tariffs')
        .insert({ household_id: householdId, ...patch });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tariff(householdId ?? 'none') });
    },
  });
}

/* ─── Энергопрофили ──────────────────────────────────────────────────────── */

export function useEnergyProfiles(householdId: string | null) {
  return useQuery({
    queryKey: keys.energyProfiles(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<EnergyProfile[]> => {
      const { data, error } = await supabase
        .from('energy_profiles')
        .select('*')
        .eq('household_id', householdId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveEnergyProfile(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      patch,
    }: {
      itemId: string;
      patch: Partial<EnergyProfile>;
    }) => {
      if (!householdId) throw new Error('Нет активного дома');

      // На вещь приходится ровно один профиль (unique на item_id в схеме),
      // поэтому upsert по нему, а не «выбрать и решить»
      const { error } = await supabase
        .from('energy_profiles')
        .upsert(
          { household_id: householdId, item_id: itemId, mode: 'typical', ...patch },
          { onConflict: 'item_id' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.energyProfiles(householdId ?? 'none'),
      });
    },
  });
}

/**
 * Профиль вещи для расчёта: свой, а если его нет — типовой из категории.
 *
 * Это и есть режим `typical` из документа: пока человек ничего не указал,
 * считаем по справочнику и честно помечаем, что число оценочное. Требовать
 * заполнения ватт до первого расчёта — способ потерять человека
 * (docs/03-energy.md).
 */
export function profileForItem(
  profile: EnergyProfile | undefined,
  category: ItemCategory | undefined
): { input: EnergyInput; fromCategory: boolean } | null {
  if (profile) return { input: profile, fromCategory: false };
  if (!category?.default_energy_mode) return null;

  return {
    fromCategory: true,
    input: {
      mode: category.default_energy_mode,
      power_w: category.default_power_w,
      standby_w: category.default_standby_w,
      duty_cycle: category.default_duty_cycle,
      hours_per_day: category.default_hours_per_day,
      kwh_per_cycle: category.default_kwh_per_cycle,
      cycles_per_week: category.default_cycles_per_week,
      label_unit: category.label_unit,
    },
  };
}

/* ─── Счётчики ───────────────────────────────────────────────────────────── */

export function useMeters(householdId: string | null) {
  return useQuery({
    queryKey: keys.meters(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Meter[]> => {
      const { data, error } = await supabase
        .from('meters')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Показания одного счётчика, свежие сверху. */
export function useReadings(meterId: string | null) {
  return useQuery({
    queryKey: ['meter-readings', meterId ?? 'none'] as const,
    enabled: Boolean(meterId),
    queryFn: async (): Promise<MeterReading[]> => {
      const { data, error } = await supabase
        .from('meter_readings')
        .select('*')
        .eq('meter_id', meterId!)
        .order('read_at', { ascending: false })
        .limit(24);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Фактический расход по счётчику, приведённый к месяцу.
 *
 * Считает база (`meter_monthly_usage`), а не клиент: там же лежат все
 * показания, и незачем тащить их на телефон ради одного вычитания.
 */
export function useMeterUsage(meterId: string | null) {
  return useQuery({
    queryKey: keys.meterUsage(meterId ?? 'none'),
    enabled: Boolean(meterId),
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase.rpc('meter_monthly_usage', {
        p_meter_id: meterId!,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddMeter(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Partial<Meter>) => {
      if (!householdId) throw new Error('Нет активного дома');
      const { error } = await supabase
        .from('meters')
        .insert({ household_id: householdId, kind: 'electricity', ...patch });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.meters(householdId ?? 'none') });
    },
  });
}

export function useAddReading(householdId: string | null, meterId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: { value_day?: number | null; value_night?: number | null; read_at?: string }) => {
      if (!householdId || !meterId) throw new Error('Нет счётчика');
      const { error } = await supabase
        .from('meter_readings')
        .insert({ household_id: householdId, meter_id: meterId, ...patch });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['meter-readings', meterId ?? 'none'] });
      void queryClient.invalidateQueries({ queryKey: keys.meterUsage(meterId ?? 'none') });
    },
  });
}
