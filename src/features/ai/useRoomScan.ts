import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import type { ItemCategory } from '@/lib/supabase/types';
import { toCompactBase64 } from './imageCompress';

export interface RoomItem {
  name: string;
  category_id: string | null;
  brand: string | null;
  confidence: 'low' | 'medium' | 'high';
  cached?: boolean;
}

export interface RoomScanResult {
  items: RoomItem[];
  cached?: boolean;
}

/**
 * Сканирование комнаты: фото → список техники для создания.
 *
 * Пользователь может снять галочки с лишних предложений или отредактировать
 * категорию перед созданием карточек.
 */
export function useRoomScan() {
  return useMutation({
    mutationFn: async (params: {
      file: File;
      householdId: string;
      categories: ItemCategory[];
    }): Promise<RoomScanResult> => {
      const base64 = await toCompactBase64(params.file);

      const { data, error } = await supabase.functions.invoke<RoomScanResult>(
        'ai-scan-room',
        {
          body: {
            householdId: params.householdId,
            image: base64,
            // Только leaf-категории (у которых есть parent_id), остальные — группы
            categories: params.categories
              .filter((category) => category.parent_id)
              .map((category) => ({ id: category.id, name: category.name_ru })),
          },
        }
      );

      if (error) throw error;
      if (!data) throw new Error('Пустой ответ');
      return data;
    },
  });
}
