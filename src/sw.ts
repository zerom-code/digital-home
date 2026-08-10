/// <reference lib="webworker" />

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

/**
 * Service worker «Домового».
 *
 * Собственный, а не сгенерированный: нужны обработчики push и
 * notificationclick — без них уведомление не показать и по нажатию никуда
 * не перейти.
 */

// __WB_MANIFEST объявляем сами, а не полагаемся на типы плагина: так сборка
// не зависит от того, какой из его type-entry подключён в tsconfig
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Список файлов оболочки подставляет vite-plugin-pwa при сборке
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: любой маршрут отдаём на index.html, иначе прямая ссылка на вещь
// в офлайне покажет ошибку вместо приложения
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Фотографии из Storage: показываем из кеша, обновляем в фоне.
// Данные из Postgres здесь не трогаем — ими занимается TanStack Query
// с персистом в IndexedDB.
registerRoute(
  ({ url }) => url.pathname.includes('/storage/v1/object/'),
  new StaleWhileRevalidate({
    cacheName: 'domovoy-photos',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

/* ─── Обновление ─────────────────────────────────────────────────────────── */

// Ждём команды от приложения: перезагружать страницу под руками у человека,
// который заполняет форму, — значит потерять его данные
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

/* ─── Уведомления ────────────────────────────────────────────────────────── */

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = { title: 'Домовой' };

  try {
    if (event.data) payload = { ...payload, ...(event.data.json() as PushPayload) };
  } catch {
    // Пришёл не JSON — покажем хотя бы заголовок, это лучше, чем ничего
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // tag с id уведомления: повторная доставка заменит старое, а не
      // насыпет три одинаковых
      tag: payload.tag ?? 'domovoy',
      data: { url: payload.url ?? '/' },
      lang: 'ru',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string })?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Приложение уже открыто — не плодим вкладки, а переходим в нужное место
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          await client.navigate(target).catch(() => undefined);
          return;
        }
      }

      await self.clients.openWindow(target);
    })()
  );
});
