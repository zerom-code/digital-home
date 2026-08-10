import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del, createStore } from 'idb-keyval';

/**
 * Кеш запросов, переживающий перезапуск приложения.
 *
 * Это и есть весь офлайн фазы 1: данные, однажды загруженные, лежат в
 * IndexedDB, поэтому приложение открывается и показывает квартиру без сети.
 * Очередь записи появится в фазе 2 (docs/05-architecture.md).
 *
 * localStorage для этого не годится: там 5 МБ и синхронный доступ, который
 * подвешивает главный поток на телефоне.
 */

const store = createStore('domovoy', 'query-cache');

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные о квартире меняются редко: держим их свежими 5 минут, а в
      // кеше — неделю, чтобы офлайн после отпуска всё ещё что-то показывал
      staleTime: 5 * 60 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        // Нет смысла долбиться, когда сети нет — вернёмся при 'online'
        if (!navigator.onLine) return false;
        // 4xx клиент не починит повтором
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get(key, store).then((v) => v ?? null),
    setItem: (key, value) => set(key, value, store),
    removeItem: (key) => del(key, store),
  },
  key: 'domovoy-query-cache',
  throttleTime: 2000,
});

/** Версия кеша: меняется, когда формат данных перестаёт быть совместимым. */
export const CACHE_BUSTER = 'v1';

/** Полная очистка — на выходе из аккаунта, чтобы чужие данные не остались. */
export async function clearCache(): Promise<void> {
  queryClient.clear();
  await del('domovoy-query-cache', store);
}

/** Ключи запросов в одном месте: иначе инвалидация промахивается по опечатке. */
export const keys = {
  session: ['session'] as const,
  profile: (userId: string) => ['profile', userId] as const,
  households: ['households'] as const,
  members: (householdId: string) => ['members', householdId] as const,
  invites: (householdId: string) => ['invites', householdId] as const,
  homes: (householdId: string) => ['homes', householdId] as const,
  spaces: (householdId: string) => ['spaces', householdId] as const,
  items: (householdId: string) => ['items', householdId] as const,
  item: (id: string) => ['item', id] as const,
  categories: ['categories'] as const,
};
