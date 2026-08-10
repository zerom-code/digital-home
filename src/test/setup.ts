import '@testing-library/jest-dom/vitest';

/**
 * Окружение для тестов.
 *
 * Переменные Supabase подставляем заранее: client.ts специально падает без
 * них, и без подмены упал бы любой тест, который его импортирует.
 */
import.meta.env.VITE_SUPABASE_URL ||= 'https://test.supabase.co';
import.meta.env.VITE_SUPABASE_ANON_KEY ||= 'test-anon-key';
import.meta.env.VITE_APP_URL ||= 'http://localhost:5173';

// jsdom не реализует matchMedia, а на него опирается определение
// standalone-режима в useInstallPrompt
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
