import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import './index.css';
import './lib/i18n';
import { queryClient, persister, CACHE_BUSTER } from './lib/query/client';
import { ToastProvider } from './components/ui';
import { ErrorBoundary } from './app/ErrorBoundary';
import { App } from './app/App';

// Режим крупного текста восстанавливаем до первой отрисовки, иначе интерфейс
// заметно дёрнется на глазах у того, кому этот режим и нужен
if (localStorage.getItem('domovoy.textSize') === 'large') {
  document.documentElement.dataset['textSize'] = 'large';
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, buster: CACHE_BUSTER, maxAge: 7 * 24 * 60 * 60 * 1000 }}
      >
        <ToastProvider>
          {/* HashRouter, а не BrowserRouter (ADR-017): GitHub Pages не умеет
              доигрывать прямые ссылки вида /item/abc — 404 на сервере.
              С хэшем (/#/item/abc) сервер вообще не видит внутренних путей,
              всё решает браузер. Не конфликтует со входом по почте — PKCE
              (lib/supabase/client.ts) кладёт код в ?code=, а не в #. */}
          <HashRouter>
            <App />
          </HashRouter>
        </ToastProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
