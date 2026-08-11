import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';

export interface ReceiptItem {
  description: string;
  price: number | null;
}

export interface ReceiptScanResult {
  items: ReceiptItem[];
  total_price: number | null;
  purchase_date: string | null; // ISO 8601 date YYYY-MM-DD
  seller: string | null;
  currency: string | null;
  cached?: boolean;
}

/** Больше 1024px модели не нужно. */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Сканирование чека: фото → дата покупки, цена, описание.
 *
 * Автоматически заполняет дату (из неё считается гарантия) и цену.
 */
export function useReceiptScan() {
  return useMutation({
    mutationFn: async (params: {
      file: File;
      householdId: string;
    }): Promise<ReceiptScanResult> => {
      const base64 = await toCompactBase64(params.file);

      const { data, error } = await supabase.functions.invoke<ReceiptScanResult>(
        'ai-scan-receipt',
        {
          body: {
            householdId: params.householdId,
            image: base64,
          },
        }
      );

      if (error) throw error;
      if (!data) throw new Error('Пустой ответ');
      return data;
    },
  });
}

/** Ужимает снимок. */
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
