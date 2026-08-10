/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      // Обновление показываем тостом, а не перезагружаем страницу под руками
      // у человека, который в этот момент заполняет форму (docs/05-architecture.md)
      registerType: 'prompt',
      injectRegister: null,

      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],

      manifest: {
        name: 'Домовой — всё о квартире',
        short_name: 'Домовой',
        description: 'Вся техника, гарантии, инструкции и расходы дома — в одном месте',
        lang: 'ru',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f6f2',
        theme_color: '#1b6e4a',
        categories: ['productivity', 'utilities', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Фотографии вещей из Storage: сначала кеш, обновление в фоне.
            // Данные из Postgres здесь не кешируем — этим занимается
            // TanStack Query с персистом в IndexedDB.
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'domovoy-photos',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: { enabled: false },
    }),
  ],

  server: {
    port: 5173,
    host: true,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
