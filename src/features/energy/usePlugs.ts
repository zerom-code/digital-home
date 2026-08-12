import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { keys } from '@/lib/query/client';
import type { PlugToken, SmartPlug } from '@/lib/supabase/types';

/**
 * Как часто перечитываем «сейчас».
 *
 * Мост шлёт heartbeat раз в минуту и вне очереди — на каждое заметное
 * изменение мощности. Пятнадцать секунд опроса означают, что включённый
 * чайник появится на экране почти сразу, а в покое лишнего трафика не будет.
 *
 * В фоновой вкладке React Query такой опрос не ведёт (refetchIntervalInBackground
 * по умолчанию выключен) — телефон не будет будиться ради цифры, на которую
 * никто не смотрит.
 */
const LIVE_REFETCH_MS = 15_000;

export function usePlugs(householdId: string | null) {
  return useQuery({
    queryKey: keys.plugs(householdId ?? 'none'),
    enabled: Boolean(householdId),
    refetchInterval: LIVE_REFETCH_MS,
    // Живое значение устаревает мгновенно: держать его «свежим» пять минут,
    // как остальную квартиру, здесь бессмысленно
    staleTime: 0,
    queryFn: async (): Promise<SmartPlug[]> => {
      const { data, error } = await supabase
        .from('smart_plugs')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Расход розетки по дням — считает база, а не телефон. */
export function usePlugDaily(plugId: string | null, days = 14) {
  return useQuery({
    queryKey: keys.plugDaily(plugId ?? 'none'),
    enabled: Boolean(plugId),
    queryFn: async (): Promise<{ day: string; wh: number }[]> => {
      const { data, error } = await supabase.rpc('plug_daily_energy', {
        p_plug_id: plugId!,
        p_days: days,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Привязка розетки к вещи и переименование.
 *
 * Розетку заводит мост, как только увидел её в сети, — человек только
 * говорит, что в неё воткнуто. Спрашивать device_id руками значило бы
 * заставить переписывать строку из консоли.
 */
export function useUpdatePlug(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SmartPlug> }) => {
      const { error } = await supabase.from('smart_plugs').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.plugs(householdId ?? 'none') });
    },
  });
}

/* ─── Ключи моста ────────────────────────────────────────────────────────── */

export function usePlugTokens(householdId: string | null) {
  return useQuery({
    queryKey: keys.plugTokens(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<PlugToken[]> => {
      const { data, error } = await supabase
        .from('plug_tokens')
        .select('*')
        .eq('household_id', householdId!)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Новый ключ для моста.
 *
 * Ключ рождается здесь, в браузере, и на сервер уходит только его хеш —
 * ровно поэтому показать его повторно невозможно ни нам, ни кому-то, кто
 * получит доступ к базе. Отсюда и правило интерфейса: показать один раз и
 * прямо сказать, что второго раза не будет.
 */
export function useCreatePlugToken(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      if (!householdId) throw new Error('Нет активного дома');

      const token = generateToken();
      const { error } = await supabase.from('plug_tokens').insert({
        household_id: householdId,
        token_hash: await sha256Hex(token),
        name: name.trim() || null,
      });
      if (error) throw error;
      return token;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.plugTokens(householdId ?? 'none') });
    },
  });
}

/** Отзыв: строку не удаляем, чтобы в списке осталась история выданных ключей. */
export function useRevokePlugToken(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('plug_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.plugTokens(householdId ?? 'none') });
    },
  });
}

/** 32 случайных байта: угадать нельзя, а глазами отличить один ключ от другого можно. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `dmv_${base64}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
