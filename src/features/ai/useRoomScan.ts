import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import type { ItemCategory } from '@/lib/supabase/types';

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

/** Больше 1024px модели не нужно, а трафик и стоимость это экономит вдвое. */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

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

/** Ужимает снимок и отдаёт голый base64 без префикса data:. */
async function toCompactBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Не удалось обработать снимок');
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
