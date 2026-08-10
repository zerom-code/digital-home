import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastAction {
  label: string;
  onAction: () => void;
}

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  tone: 'neutral' | 'danger';
}

interface ToastApi {
  show: (message: string, options?: { action?: ToastAction; tone?: Toast['tone'] }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Сколько живёт тост с кнопкой «Отменить». */
const UNDO_MS = 5000;
const PLAIN_MS = 2500;

/**
 * Тосты — замена диалогам «Вы уверены?» (ADR-011).
 *
 * Диалог подтверждения тормозит всех, а защищает только от промаха. Отмена
 * защищает лучше и никого не останавливает.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, options) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        message,
        tone: options?.tone ?? 'neutral',
        ...(options?.action ? { action: options.action } : {}),
      };
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => dismiss(id), options?.action ? UNDO_MS : PLAIN_MS);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // role=status, а не alert: тост сообщает результат, а не тревогу
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              'pointer-events-auto flex w-full max-w-md items-center justify-between gap-3',
              'rounded-xl px-4 py-3 text-white shadow-lg',
              toast.tone === 'danger' ? 'bg-danger' : 'bg-ink',
            ].join(' ')}
          >
            <span className="text-sm">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-10 shrink-0 rounded-lg px-3 font-semibold underline underline-offset-2"
                onClick={() => {
                  toast.action?.onAction();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast должен вызываться внутри ToastProvider');
  return context;
}
