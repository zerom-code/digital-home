import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { flush, useOutboxStatus } from '@/lib/outbox';

/**
 * Полоска «работаем офлайн».
 *
 * Не красный экран ошибки: отсутствие сети — это режим работы, а не поломка.
 * Приложение продолжает показывать сохранённое (docs/04-ux.md).
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const outbox = useOutboxStatus();

  // Всё отправлено и сеть на месте — полоска не нужна
  if (online && outbox.pending === 0 && outbox.stuck === 0) return null;

  if (outbox.stuck > 0) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 bg-danger-soft px-4 py-2 text-sm text-danger"
      >
        <span aria-hidden="true">⚠</span>
        {t('outbox.stuck', { count: outbox.stuck })}
        <button
          type="button"
          onClick={() => void flush()}
          className="font-semibold underline underline-offset-2"
        >
          {t('outbox.retry')}
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn"
    >
      <span aria-hidden="true">{online ? '⏳' : '📴'}</span>
      {outbox.pending > 0 ? t('outbox.pending', { count: outbox.pending }) : t('pwa.offline')}
    </div>
  );
}

/**
 * Тост «есть новая версия».
 *
 * Обновляемся только по нажатию: перезагрузить страницу под руками у
 * человека, который заполняет форму, — потерять его данные.
 */
export function UpdateToast() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-lg">
        <span className="text-sm">{t('pwa.updateAvailable')}</span>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-lg px-3 font-semibold underline underline-offset-2"
          onClick={() => {
            setNeedRefresh(false);
            void updateServiceWorker(true);
          }}
        >
          {t('pwa.updateAction')}
        </button>
      </div>
    </div>
  );
}
