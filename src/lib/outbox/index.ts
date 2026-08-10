import { useEffect, useState } from 'react';

import { enqueue, putBlob, readQueue, subscribe, clearOutbox } from './store';
import { flush, startSync } from './sync';
import { summarize } from './queue';
import type { Operation, SyncTable } from './types';

export { startSync, flush, clearOutbox };
export type { Operation, SyncTable };

/**
 * Записать намерение в очередь и сразу попробовать отправить.
 *
 * Если сеть есть — уйдёт мгновенно, и человек не заметит, что очередь вообще
 * существует. Если нет — полежит и уйдёт позже.
 */
export async function queueOperation(op: Operation): Promise<void> {
  await enqueue(op);
  void flush();
}

/** Кладёт файл в хранилище очереди и ставит загрузку. */
export async function queueUpload(params: {
  blob: Blob;
  path: string;
  contentType: string;
  attachTo?: { table: SyncTable; id: string; column: string };
}): Promise<void> {
  const blobKey = await putBlob(params.blob);
  await queueOperation({
    kind: 'upload',
    bucket: 'docs',
    path: params.path,
    blobKey,
    contentType: params.contentType,
    ...(params.attachTo ? { attachTo: params.attachTo } : {}),
  });
}

/** Состояние очереди для полоски в шапке. */
export function useOutboxStatus() {
  const [status, setStatus] = useState({ pending: 0, stuck: 0 });

  useEffect(() => {
    let alive = true;

    const refresh = () => {
      void readQueue().then((entries) => {
        if (alive) setStatus(summarize(entries));
      });
    };

    refresh();
    const unsubscribe = subscribe(refresh);

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return status;
}
