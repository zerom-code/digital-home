import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, storagePath } from '@/lib/supabase/client';
import { keys } from '@/lib/query/client';
import type { Home, Item, ItemCategory, Space } from '@/lib/supabase/types';

/* ─── Чтение ─────────────────────────────────────────────────────────────── */

export function useHomes(householdId: string | null) {
  return useQuery({
    queryKey: keys.homes(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Home[]> => {
      const { data, error } = await supabase
        .from('homes')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSpaces(householdId: string | null) {
  return useQuery({
    queryKey: keys.spaces(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Space[]> => {
      const { data, error } = await supabase
        .from('spaces')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useItems(householdId: string | null) {
  return useQuery({
    queryKey: keys.items(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('household_id', householdId!)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: keys.item(id ?? 'none'),
    enabled: Boolean(id),
    queryFn: async (): Promise<Item | null> => {
      const { data, error } = await supabase.from('items').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** Справочник категорий. Он общий и почти не меняется — держим сутки. */
export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async (): Promise<ItemCategory[]> => {
      const { data, error } = await supabase.from('item_categories').select('*').order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* ─── Запись ─────────────────────────────────────────────────────────────── */

function invalidateHome(queryClient: ReturnType<typeof useQueryClient>, householdId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.items(householdId) }),
    queryClient.invalidateQueries({ queryKey: keys.spaces(householdId) }),
    queryClient.invalidateQueries({ queryKey: keys.homes(householdId) }),
  ]);
}

export interface NewItem {
  name: string;
  space_id?: string | null;
  home_id?: string | null;
  category_id?: string | null;
  photo?: File | null;
}

/**
 * Создание вещи.
 *
 * id генерирует клиент: так повторная отправка (в том числе из будущей
 * офлайн-очереди) не создаёт дубль — в базе стоит on conflict do update.
 */
export function useCreateItem(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewItem): Promise<Item> => {
      if (!householdId) throw new Error('Нет активного дома');

      const id = crypto.randomUUID();
      let photoPath: string | null = null;

      if (input.photo) {
        photoPath = storagePath(householdId, id, input.photo.name);
        const { error } = await supabase.storage.from('docs').upload(photoPath, input.photo, {
          contentType: input.photo.type,
          upsert: true,
        });
        // Фото не загрузилось — вещь всё равно сохраняем: потерять запись
        // хуже, чем потерять картинку
        if (error) photoPath = null;
      }

      const { data, error } = await supabase
        .from('items')
        .upsert({
          id,
          household_id: householdId,
          name: input.name.trim(),
          space_id: input.space_id ?? null,
          home_id: input.home_id ?? null,
          category_id: input.category_id ?? null,
          photo_path: photoPath,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });
}

export function useUpdateItem(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Item> }): Promise<Item> => {
      const { data, error } = await supabase
        .from('items')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({ queryKey: keys.item(item.id) });
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });
}

/**
 * Мягкое удаление и восстановление.
 *
 * Пара нужна целиком: без restore кнопка «Отменить» в тосте была бы обманом
 * (ADR-011).
 */
export function useDeleteItem(householdId: string | null) {
  const queryClient = useQueryClient();

  const setDeleted = async (id: string, value: string | null) => {
    const { error } = await supabase.from('items').update({ deleted_at: value }).eq('id', id);
    if (error) throw error;
  };

  const remove = useMutation({
    mutationFn: (id: string) => setDeleted(id, new Date().toISOString()),
    onSuccess: async () => {
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => setDeleted(id, null),
    onSuccess: async () => {
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });

  return { remove, restore };
}

export function useCreateSpace(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; kind?: string | null; icon?: string | null; home_id?: string | null }) => {
      if (!householdId) throw new Error('Нет активного дома');

      const { data, error } = await supabase
        .from('spaces')
        .insert({
          household_id: householdId,
          name: input.name.trim(),
          kind: (input.kind ?? null) as Space['kind'],
          icon: input.icon ?? null,
          home_id: input.home_id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });
}

export function useDeleteSpace(householdId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Вещи не трогаем: они переедут в группу «Без комнаты» и не пропадут
      const { error } = await supabase
        .from('spaces')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      if (householdId) await invalidateHome(queryClient, householdId);
    },
  });
}
