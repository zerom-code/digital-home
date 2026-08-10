import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export { Button } from './Button';
export { Input, Textarea, Select } from './Field';
export { Sheet } from './Sheet';
export { ToastProvider, useToast } from './Toast';
export { PhotoPicker } from './PhotoPicker';

/** Карточка — основной контейнер контента. */
export function Card({
  children,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <As className={`rounded-card border border-line bg-surface ${className}`}>{children}</As>
  );
}

/**
 * Пустое состояние.
 *
 * Не «Нет данных», а объяснение что делать и кнопка — иначе человек
 * упирается в тупик (docs/04-ux.md).
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-4xl">{icon}</div>}
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {text && <p className="max-w-sm text-ink-2">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Блок карточки вещи, который пока не заполнен.
 *
 * Показывается как приглашение с конкретной выгодой, а не прячется:
 * это и есть «лестница ценности» в интерфейсном виде.
 */
export function InviteBlock({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 border-dashed p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{icon}</span>
        <h3 className="font-semibold text-ink">{title}</h3>
      </div>
      <p className="text-sm text-ink-2">{text}</p>
      {action && <div className="mt-1">{action}</div>}
    </Card>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warn' | 'danger';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  } as const;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-12 text-ink-3">
      <span className="size-8 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Строка списка в разделе «Ещё». */
export function Row({
  to,
  onClick,
  icon,
  title,
  value,
  danger = false,
}: {
  to?: string;
  onClick?: () => void;
  icon?: ReactNode;
  title: string;
  value?: ReactNode;
  danger?: boolean;
}) {
  const inner = (
    <>
      {icon && <span aria-hidden="true" className="w-6 text-center">{icon}</span>}
      <span className={`flex-1 text-left ${danger ? 'text-danger' : 'text-ink'}`}>{title}</span>
      {value && <span className="text-ink-3">{value}</span>}
    </>
  );

  const classes =
    'flex min-h-14 w-full items-center gap-3 border-b border-line px-4 last:border-b-0 active:bg-surface-2';

  if (to) {
    return (
      <Link to={to} className={classes}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {inner}
    </button>
  );
}
