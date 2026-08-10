import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

/** Шапка внутреннего экрана: назад, заголовок и, при необходимости, действие. */
export function PageHeader({
  title,
  icon,
  action,
}: {
  title: string;
  icon?: string | undefined;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/95 px-2 py-2 backdrop-blur">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label={t('common.back')}
        className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-2 active:bg-surface-2"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <h1 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold text-ink">
        {icon && <span aria-hidden="true">{icon}</span>}
        <span className="truncate">{title}</span>
      </h1>

      {action}
    </header>
  );
}
