import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import { queryClient } from '@/lib/query/client';

import type { Entry, Operation } from './types';
import { compact, due, isPermanent, markFailed, ordered, tablesTouched } from './queue';
import {
  dropBlob,
  readQueue,
  removeEntries,
  replaceEntry,
  takeBlob,
  writeQueue,
} from './store';

/**
 * Отправка очереди.
 *
 * Запускается при появлении сети, при возврате в приложение и после каждой
 * мутации. Фоновой синхронизации нет — на iOS Background Sync не работает
 * вовсе, поэтому единственный надёжный момент отправки это когда приложение
 * открыто (docs/05-architecture.md).
 */

let running = false;

export async function flush(): Promise<{ sent: number; failed: number }> {
  // Два одновременных прохода отправили бы одно и то же дважды
  if (running || !navigator.onLine) return { sent: 0, failed: 0 };

  running = true;
  try {
    const compacted = compact(ordered(await readQueue()));
    await writeQueue(compacted);

    const batch = due(compacted, Date.now());
    if (batch.length === 0) return { sent: 0, failed: 0 };

    const doneIds: string[] = [];
    let failed = 0;

    for (const entry of batch) {
      const result = await send(entry.op);

      if (result.ok) {
        doneIds.push(entry.entryId);
        if (entry.op.kind === 'upload') await dropBlob(entry.op.blobKey);
        continue;
      }

      failed++;
      await replaceEntry(
        markFailed(entry, result.message, Date.now(), isPermanent(result.status))
      );
    }

    if (doneIds.length > 0) await removeEntries(doneIds);

    // Отправленное могло измениться и на сервере (триггеры, дефолты) —
    // перечитываем затронутые таблицы
    const householdId = localStorage.getItem('domovoy.household');
    if (householdId) {
      for (const table of tablesTouched(batch)) {
        void queryClient.invalidateQueries({ queryKey: [table, householdId] });
      }
    }

    return { sent: doneIds.length, failed };
  } finally {
    running = false;
  }
}

interface SendResult {
  ok: boolean;
  status?: number;
  message: string;
}

/**
 * Таблица известна только в рантайме, поэтому типизация схемы здесь не
 * помогает: `from()` с union-именем даёт union построителей запросов, у
 * которых несовместимые сигнатуры. Обращаемся через нетипизированный клиент —
 * правильность этих вызовов стерегут тесты RLS, а не компилятор.
 */
const db = supabase as unknown as SupabaseClient;

async function send(op: Operation): Promise<SendResult> {
  try {
    switch (op.kind) {
      case 'upsert': {
        // id приходит от клиента, поэтому повтор — это обновление той же
        // строки, а не дубль
        const { error } = await db.from(op.table).upsert({ ...op.payload, id: op.id });
        return toResult(error);
      }

      case 'update': {
        const { error } = await db.from(op.table).update(op.patch).eq('id', op.id);
        return toResult(error);
      }

      case 'delete': {
        const { error } = await db
          .from(op.table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', op.id);
        return toResult(error);
      }

      case 'upload': {
        const blob = await takeBlob(op.blobKey);
        // Файл потерялся (браузер вычистил хранилище) — повторять нечего
        if (!blob) return { ok: false, status: 410, message: 'файл больше недоступен' };

        const { error } = await supabase.storage
          .from(op.bucket)
          .upload(op.path, blob, { contentType: op.contentType, upsert: true });

        if (error) return { ok: false, message: error.message };

        if (op.attachTo) {
          const { error: linkError } = await db
            .from(op.attachTo.table)
            .update({ [op.attachTo.column]: op.path })
            .eq('id', op.attachTo.id);
          if (linkError) return toResult(linkError);
        }

        return { ok: true, message: '' };
      }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'неизвестная ошибка' };
  }
}

function toResult(error: { message: string; code?: string } | null): SendResult {
  if (!error) return { ok: true, message: '' };

  // PostgREST отдаёт код ошибки Postgres. 42501 — нарушение политики RLS,
  // 23503 — сломанная ссылка: повторять и то и другое бессмысленно
  const permanent = error.code === '42501' || error.code?.startsWith('23');
  return { ok: false, status: permanent ? 403 : undefined, message: error.message };
}

/* ─── Автозапуск ─────────────────────────────────────────────────────────── */

let installed = false;

/**
 * Подписывается на моменты, когда отправка имеет шанс пройти.
 *
 * visibilitychange важен на телефоне: вкладку не закрывают, а сворачивают,
 * и возврат в приложение — самый частый момент, когда сеть уже появилась.
 */
export function startSync(): void {
  if (installed) return;
  installed = true;

  const run = () => void flush();

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });

  // Раз в минуту на случай, если событие 'online' не пришло: в мобильных
  // сетях переход между вышками этого события не порождает
  window.setInterval(run, 60_000);

  run();
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export type { Entry };
