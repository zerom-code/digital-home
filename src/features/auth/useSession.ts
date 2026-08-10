import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import { clearCache } from '@/lib/query/client';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

/**
 * Текущая сессия — один источник на всё приложение.
 *
 * Держим её не в TanStack Query: сессию обновляет сам supabase-js по таймеру,
 * и второй источник правды тут только мешает.
 *
 * Состояние вынесено из хука в модуль намеренно. Пока useSession звали из
 * одного места, своя копия состояния у каждого вызова была просто лишней
 * работой — свой getSession(), своя подписка. Но теперь готовность сессии
 * спрашивает ещё и useActiveHousehold, а от этого ответа зависит, показать
 * дом или предложить создать новый. Две независимые копии могли бы разойтись
 * во мнении, и цена расхождения — предложение завести второй дом поверх
 * существующего. Поэтому состояние общее, а хук только подписывается.
 */
let state: SessionState = { session: null, loading: true };
const listeners = new Set<() => void>();

function publish(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

// Восстановление сессии из хранилища асинхронное, и до его конца
// пользователь ещё «не вошёл» с точки зрения любого запроса к базе
let settled = false;

void supabase.auth.getSession().then(({ data }) => {
  if (settled) return;
  settled = true;
  publish({ session: data.session, loading: false });
});

// Вход, выход и обновление токена по таймеру приходят сюда же и всегда
// главнее разового getSession()
supabase.auth.onAuthStateChange((_event, session) => {
  settled = true;
  publish({ session, loading: false });
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SessionState {
  return state;
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Выход из аккаунта.
 *
 * Кеш обязательно чистим: иначе следующий человек на этом телефоне увидит
 * чужую квартиру из IndexedDB, даже не имея доступа к серверу.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  await clearCache();
}
