import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ притворяется Mac — отличаем по тач-точкам
  const isIpad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpad) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS до сих пор сообщает об этом собственным нестандартным полем
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Установка на домашний экран.
 *
 * На Android перехватываем beforeinstallprompt и показываем свою кнопку в
 * подходящий момент. На iOS такого события нет вовсе — там остаётся только
 * инструкция «Поделиться → На экран „Домой“», и без неё установку никто не
 * найдёт, а без установки iPhone не сможет присылать напоминания
 * (docs/05-architecture.md).
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const platform = detectPlatform();

  return {
    platform,
    installed,
    /** Android и десктопный Chrome умеют системное окно установки */
    canPrompt: Boolean(deferred),
    /** На iOS остаётся только показать инструкцию */
    needsManualInstructions: platform === 'ios' && !installed,
    prompt: async (): Promise<boolean> => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      return outcome === 'accepted';
    },
  };
}
