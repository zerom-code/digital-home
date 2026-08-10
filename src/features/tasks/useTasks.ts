import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import type { Task } from '@/lib/supabase/types';

export const taskKeys = {
  all: (householdId: string) => ['tasks', householdId] as const,
};

export function useTasks(householdId: string | null) {
  return useQuery({
    queryKey: taskKeys.all(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('due_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Пересчёт задач из гарантий, ТО и расходников.
 *
 * Ночной запуск по расписанию делает то же самое, но человек не должен
 * ждать до утра, чтобы увидеть напоминание про только что введённую дату
 * покупки.
 */
export function useRefreshTasks(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('refresh_my_tasks');
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: async () => {
      if (householdId) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.all(householdId) });
      }
    },
  });
}

export function useCompleteTask(householdId: string | null) {
  const queryClient = useQueryClient();

  const setStatus = async (id: string, status: Task['status']) => {
    const { error } = await supabase
      .from('tasks')
      .update({
        status,
        completed_at: status === 'open' ? null : new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  };

  const invalidate = async () => {
    if (householdId) {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all(householdId) });
    }
  };

  return {
    complete: useMutation({
      mutationFn: (id: string) => setStatus(id, 'done'),
      onSuccess: invalidate,
    }),
    skip: useMutation({
      mutationFn: (id: string) => setStatus(id, 'skipped'),
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: (id: string) => setStatus(id, 'open'),
      onSuccess: invalidate,
    }),
  };
}

export interface NewTask {
  title: string;
  due_at?: string | null;
  interval_days?: number | null;
  item_id?: string | null;
}

export function useCreateTask(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewTask): Promise<Task> => {
      if (!householdId) throw new Error('Нет активного дома');

      const { data, error } = await supabase
        .from('tasks')
        .insert({
          household_id: householdId,
          title: input.title.trim(),
          due_at: input.due_at || null,
          interval_days: input.interval_days ?? null,
          item_id: input.item_id ?? null,
          source: 'manual',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      if (householdId) {
        await queryClient.invalidateQueries({ queryKey: taskKeys.all(householdId) });
      }
    },
  });
}
