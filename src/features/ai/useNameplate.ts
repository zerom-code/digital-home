import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import type { ItemCategory } from '@/lib/supabase/types';
import { toCompactBase64 } from './imageCompress';

export interface NameplateResult {
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  power_w: number | null;
  voltage: number | null;
  year: number | null;
  category_hint: string | null;
  confidence: 'low' | 'medium' | 'high';
  cached?: boolean;
}

/**
 * Распознавание заводской таблички.
 *
 * Модель возвращает **черновик формы**, а не запись в базе: человек смотрит,
 * правит и подтверждает. Поля, пришедшие от модели, помечаются в интерфейсе
 * значком ✨ (ADR-008).
 */
export function useNameplateScan() {
  return useMutation({
    mutationFn: async (params: {
      file: File;
      householdId: string;
      categories: ItemCategory[];
    }): Promise<NameplateResult> => {
      const base64 = await toCompactBase64(params.file);

      const { data, error } = await supabase.functions.invoke<NameplateResult>(
        'ai-extract-nameplate',
        {
          body: {
            householdId: params.householdId,
            image: base64,
            // Список категорий передаём, чтобы модель не изобретала свои
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

/** Есть ли что показывать в форме после распознавания. */
export function hasAnything(result: NameplateResult): boolean {
  return Boolean(
    result.brand || result.model || result.serial_number || result.power_w || result.year
  );
}
