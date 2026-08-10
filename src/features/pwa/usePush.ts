import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import { isStandalone, detectPlatform } from './useInstallPrompt';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushState =
  | 'unsupported'      // браузер не умеет push вовсе
  | 'needs-install'    // iOS: только после добавления на домашний экран
  | 'denied'           // человек отказал; передумать можно только в настройках
  | 'off'
  | 'on';

/**
 * Подписка на уведомления.
 *
 * Главная особенность — iOS: Push API там доступен **только** приложениям,
 * добавленным на домашний экран (16.4+). Во вкладке Safari PushManager
 * отсутствует, поэтому спрашивать разрешение бессмысленно — сначала надо
 * довести человека до установки (docs/05-architecture.md).
 */
export function usePush() {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);

  const detect = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState(detectPlatform() === 'ios' && !isStandalone() ? 'needs-install' : 'unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    setState(existing ? 'on' : 'off');
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!VAPID_PUBLIC_KEY) {
      console.warn('VITE_VAPID_PUBLIC_KEY не задан — подписка невозможна');
      return false;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = subscription.toJSON();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return false;

      // Одна и та же подписка при переустановке приходит с тем же endpoint —
      // поэтому upsert, а не insert
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: auth.user.id,
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth_key: json.keys?.auth ?? '',
          user_agent: navigator.userAgent,
          failed_at: null,
        },
        { onConflict: 'endpoint' }
      );

      if (error) throw error;

      setState('on');
      return true;
    } catch (error) {
      console.error('Не удалось подписаться на уведомления:', error);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setState('off');
        return;
      }

      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe();
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable, refresh: detect };
}

/** VAPID-ключ приходит в base64url, а applicationServerKey ждёт байты. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);

  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
