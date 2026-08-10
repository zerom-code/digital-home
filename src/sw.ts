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

// SPA: любой переход отдаём на index.html. С хэш-роутером (main.tsx) сервер
// вообще не видит «глубоких» путей вроде /item/abc — всё после # остаётся
// только в браузере, — но фолбэк оставляем как страховку на полную
// перезагрузку офлайн. import.meta.env.BASE_URL — тот же basePath из
// vite.config.ts, подставленный сборкой (для GitHub Pages это /digital-home/,
// иначе '/').
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${import.meta.env.BASE_URL}index.html`))
);

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

/**
 * queue_task_notifications() в базе кладёт в notifications.url обычный
 * логический путь вида «/item/abc123» — так его проще собрать SQL-строкой,
 * и таблица ничего не должна знать о том, что фронтенд живёт за
 * хэш-роутером. Настоящий адрес для навигации собираем здесь: путь после
 * «#» на URL текущего скоупа. self.registration.scope уже учитывает и
 * origin, и базовый путь (на GitHub Pages это .../digital-home/) — фрагмент
 * заменяет только хэш, остальное берётся из скоупа как есть.
 */
function toAppUrl(path: string): string {
  return new URL(`#${path}`, self.registration.scope).href;
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
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      badge: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      // tag с id уведомления: повторная доставка заменит старое, а не
      // насыпет три одинаковых
      tag: payload.tag ?? 'domovoy',
      data: { url: toAppUrl(payload.url ?? '/') },
      lang: 'ru',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // url в data уже полный адрес — его собрал toAppUrl() в обработчике push
  const target = (event.notification.data as { url?: string })?.url ?? self.registration.scope;

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
