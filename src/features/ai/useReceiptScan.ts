import { useMutation } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { toCompactBase64 } from './imageCompress';

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
