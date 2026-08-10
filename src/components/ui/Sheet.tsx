import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Bottom sheet на нативном <dialog>.
 *
 * showModal() бесплатно даёт закрытие по Esc, ловушку фокуса, inert для
 * фона и правильный слой поверх всего — то, ради чего обычно тянут Radix.
 * Модалок поверх модалок нет по замыслу (docs/04-ux.md).
 */
export function Sheet({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Esc и клик по фону закрывают лист — состояние держит родитель
    const handleClose = () => onClose();
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-0 mt-auto w-full sm:mx-auto sm:mb-auto sm:max-w-lg"
      onClick={(event) => {
        // Клик мимо содержимого — по самому <dialog>, а не по его детям
        if (event.target === ref.current) onClose();
      }}
    >
      <div
        className={
          'flex max-h-[90dvh] flex-col rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] ' +
          'sm:rounded-2xl'
        }
      >
        <div className="relative flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <span aria-hidden="true" className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-2 sm:hidden" />
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-mr-2 flex size-12 shrink-0 items-center justify-center rounded-full text-ink-3 active:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </dialog>
  );
}
