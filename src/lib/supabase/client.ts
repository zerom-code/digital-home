import { createClient } from '@supabase/supabase-js';

import type { Database } from './types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY. ' +
      'Скопируйте .env.example в .env и заполните — см. docs/09-setup.md'
  );
}

/**
 * Клиент Supabase.
 *
 * anon-ключ публичный по замыслу: доступ к данным ограничивает Row Level
 * Security, а не секретность ключа (docs/02-data-model.md).
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Ссылка входа приходит письмом и открывается в браузере: токен из
    // адресной строки нужно подхватить
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-application-name': 'domovoy' },
  },
});

/** Публичная ссылка на файл в приватном бакете, живёт час. */
export async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('docs').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

/**
 * Путь файла в бакете. Первый сегмент — household_id: именно по нему
 * политика доступа решает, кому файл виден.
 */
export function storagePath(householdId: string, itemId: string | null, fileName: string): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return `${householdId}/${itemId ?? 'general'}/${crypto.randomUUID()}${ext}`;
}
