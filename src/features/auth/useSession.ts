import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import { clearCache } from '@/lib/query/client';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

/**
 * Текущая сессия.
 *
 * Держим её в React-состоянии, а не в TanStack Query: сессию обновляет сам
 * supabase-js по таймеру, и второй источник правды тут только мешает.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setState({ session: data.session, loading: false });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ session, loading: false });
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return state;
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
