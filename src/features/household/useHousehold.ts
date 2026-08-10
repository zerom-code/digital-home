import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { keys } from '@/lib/query/client';
import { useSession } from '@/features/auth/useSession';
import type { Household, HouseholdInvite, HouseholdMember, Profile, Role } from '@/lib/supabase/types';
import { generateInviteCode } from '@/lib/invite';

const ACTIVE_KEY = 'domovoy.household';

/** Какой дом открыт сейчас. Домов может быть несколько: квартира, дача, гараж. */
export function getActiveHouseholdId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveHouseholdId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

export interface MembershipRow extends HouseholdMember {
  households: Household | null;
}

/**
 * Семьи, в которых состоит пользователь, вместе с его ролью.
 *
 * `enabled` приходит снаружи (useActiveHousehold) и стоит на паузе, пока
 * сессия не подтверждена — см. комментарий там же про гонку на холодном
 * старте.
 */
export function useMemberships(enabled = true) {
  return useQuery({
    queryKey: keys.households,
    enabled,
    queryFn: async (): Promise<MembershipRow[]> => {
      const { data, error } = await supabase
        .from('household_members')
        .select('*, households(*)')
        .order('joined_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as MembershipRow[];
    },
  });
}

/**
 * Активная семья и роль в ней.
 *
 * Если сохранённой семьи больше нет (вышли или удалили), молча
 * переключаемся на первую доступную, а не показываем пустой экран.
 *
 * **Гонка на холодном старте.** App.tsx вызывает этот хук ещё до того, как
 * `supabase-js` восстановит сессию из хранилища: восстановление асинхронное,
 * а хуки должны звать одинаково при каждом рендере. Без явного ожидания
 * запрос на household_members уходил бы раньше токена — под RLS это не
 * ошибка, а честный пустой список, потому что не считается вошедшим никто.
 * Offline-персистер (lib/query/client.ts) сохранял этот пустой список в
 * IndexedDB как последний известный результат, а защёлка онбординга в
 * App.tsx («семьи ещё нет — показать онбординг и не выходить обратно»)
 * фиксировала это неверное состояние намертво: реальный дом лежал в базе
 * невредимым, а приложение при каждом новом запуске снова просило создать
 * его с нуля.
 *
 * Решение — держать запрос на паузе (`enabled: false`), пока не пришёл хотя
 * бы один ответ от `supabase.auth.getSession()` или `onAuthStateChange`
 * (useSession). Но TanStack в состоянии «пауза» сам показывает
 * `isLoading: false` — будто уже всё загружено и семей нет, та же ловушка
 * заново. Поэтому `isLoading` наружу считаем отдельно, включая в него и
 * ожидание сессии.
 */
export function useActiveHousehold() {
  const { session, loading: sessionLoading } = useSession();
  const sessionReady = !sessionLoading && Boolean(session);
  const memberships = useMemberships(sessionReady);

  const stored = getActiveHouseholdId();
  const rows = memberships.data ?? [];
  const active = rows.find((row) => row.household_id === stored) ?? rows[0] ?? null;

  // Запись в localStorage — побочный эффект, ему не место в рендере
  useEffect(() => {
    if (active && active.household_id !== stored) {
      setActiveHouseholdId(active.household_id);
    }
  }, [active, stored]);

  return {
    householdId: active?.household_id ?? null,
    household: active?.households ?? null,
    role: (active?.role ?? null) as Role | null,
    canWrite: active ? active.role !== 'guest' : false,
    isAdmin: active ? active.role === 'owner' || active.role === 'admin' : false,
    isLoading: !sessionReady || memberships.isLoading,
    error: memberships.error,
  };
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      const { data, error } = await supabase.rpc('create_household', { p_name: name });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (householdId) => {
      setActiveHouseholdId(householdId);
      await queryClient.invalidateQueries({ queryKey: keys.households });
    },
  });
}

export interface MemberRow extends HouseholdMember {
  profiles: Profile | null;
}

export function useMembers(householdId: string | null) {
  return useQuery({
    queryKey: keys.members(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from('household_members')
        .select('*, profiles(*)')
        .eq('household_id', householdId!)
        .order('joined_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as MemberRow[];
    },
  });
}

/** Действующие приглашения — те, что можно отправить прямо сейчас. */
export function useInvites(householdId: string | null) {
  return useQuery({
    queryKey: keys.invites(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<HouseholdInvite[]> => {
      const { data, error } = await supabase
        .from('household_invites')
        .select('*')
        .eq('household_id', householdId!)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateInvite(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (role: Exclude<Role, 'owner'> = 'member'): Promise<HouseholdInvite> => {
      if (!householdId) throw new Error('Нет активного дома');

      // Код придумывает клиент; уникальность стережёт ограничение в базе
      const { data, error } = await supabase
        .from('household_invites')
        .insert({
          household_id: householdId,
          code: generateInviteCode(),
          role,
          max_uses: 20,
          expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.invites(householdId ?? 'none') });
    },
  });
}

export function useRevokeInvite(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('household_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.invites(householdId ?? 'none') });
    },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc('accept_invite', { p_code: code });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (householdId) => {
      setActiveHouseholdId(householdId);
      await queryClient.invalidateQueries();
    },
  });
}
