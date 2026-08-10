import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { CenteredScreen } from './CenteredScreen';

interface State {
  error: Error | null;
}

/**
 * Последний рубеж.
 *
 * Текст сознательно без стектрейса и без слова «исключение»: человеку нужно
 * знать, что делать, а не что именно упало. Подробности — в консоли.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Домовой упал:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <CenteredScreen className="items-center gap-4 py-10 text-center">
        <p className="text-5xl" aria-hidden="true">🛠</p>
        <h1 className="text-2xl font-bold text-ink">Что-то пошло не так</h1>
        <p className="text-ink-2">
          Попробуй ещё раз. Если не помогает — перезайди в приложение.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-12 rounded-xl bg-accent px-6 font-semibold text-white"
        >
          Обновить
        </button>
      </CenteredScreen>
    );
  }
}
