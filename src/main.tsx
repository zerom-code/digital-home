import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
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
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
