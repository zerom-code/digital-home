import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase, storagePath } from '@/lib/supabase/client';
import { queueUpload } from '@/lib/outbox';
import type { DocumentKind, ItemDocument } from '@/lib/supabase/types';

export const documentKeys = {
  byItem: (itemId: string) => ['documents', 'item', itemId] as const,
  byHousehold: (householdId: string) => ['documents', householdId] as const,
};

export function useDocuments(itemId: string | undefined) {
  return useQuery({
    queryKey: documentKeys.byItem(itemId ?? 'none'),
    enabled: Boolean(itemId),
    queryFn: async (): Promise<ItemDocument[]> => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('item_id', itemId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface NewDocument {
  itemId: string;
  householdId: string;
  kind: DocumentKind;
  title?: string;
  file?: File | null;
  externalUrl?: string | null;
}

/**
 * Добавление документа.
 *
 * Инструкцию можно не загружать, а дать ссылку на сайт производителя — для
 * восьмидесятистраничного PDF это и быстрее, и честнее. Поэтому файл здесь
 * необязателен.
 *
 * Файл уходит через очередь: инструкции весят мегабайты, и на мобильном
 * интернете загрузка может не пройти с первого раза.
 */
export function useAddDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: NewDocument): Promise<void> => {
      const id = crypto.randomUUID();
      const path = input.file
        ? storagePath(input.householdId, input.itemId, input.file.name)
        : null;

      const { error } = await supabase.from('documents').insert({
        id,
        household_id: input.householdId,
        item_id: input.itemId,
        kind: input.kind,
        title: input.title?.trim() || input.file?.name || null,
        storage_path: path,
        external_url: input.externalUrl?.trim() || null,
        mime_type: input.file?.type ?? null,
        size_bytes: input.file?.size ?? null,
      });

      if (error) throw error;

      if (input.file && path) {
        await queueUpload({
          blob: input.file,
          path,
          contentType: input.file.type || 'application/octet-stream',
        });
      }
    },
    onSuccess: async (_result, input) => {
      await queryClient.invalidateQueries({ queryKey: documentKeys.byItem(input.itemId) });
    },
  });
}

export function useDeleteDocument(itemId: string) {
  const queryClient = useQueryClient();

  const setDeleted = async (id: string, value: string | null) => {
    const { error } = await supabase.from('documents').update({ deleted_at: value }).eq('id', id);
    if (error) throw error;
  };

  const remove = useMutation({
    mutationFn: (id: string) => setDeleted(id, new Date().toISOString()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentKeys.byItem(itemId) }),
  });

  const restore = useMutation({
    mutationFn: (id: string) => setDeleted(id, null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentKeys.byItem(itemId) }),
  });

  return { remove, restore };
}
