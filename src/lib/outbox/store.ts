import { get, set, del, createStore } from 'idb-keyval';

import type { Entry, Operation } from './types';

/**
 * Хранилище очереди.
 *
 * Вся очередь лежит одним значением: в домашнем инвентаре это десятки
 * записей, и читать их целиком дешевле, чем городить курсоры. Файлы лежат
 * отдельными ключами — их нельзя держать в одном массиве с метаданными,
 * иначе каждое чтение очереди тянуло бы за собой мегабайты.
 */

const outboxStore = createStore('domovoy-outbox', 'entries');
const blobStore = createStore('domovoy-outbox', 'blobs');

const QUEUE_KEY = 'queue';

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readQueue(): Promise<Entry[]> {
  return (await get<Entry[]>(QUEUE_KEY, outboxStore)) ?? [];
}

export async function writeQueue(entries: Entry[]): Promise<void> {
  if (entries.length === 0) await del(QUEUE_KEY, outboxStore);
  else await set(QUEUE_KEY, entries, outboxStore);
  notify();
}

export async function enqueue(op: Operation): Promise<Entry> {
  const entry: Entry = {
    entryId: crypto.randomUUID(),
    op,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
  };

  await writeQueue([...(await readQueue()), entry]);
  return entry;
}

export async function removeEntries(entryIds: string[]): Promise<void> {
  const ids = new Set(entryIds);
  const rest = (await readQueue()).filter((entry) => !ids.has(entry.entryId));
  await writeQueue(rest);
}

export async function replaceEntry(entry: Entry): Promise<void> {
  const queue = await readQueue();
  const index = queue.findIndex((candidate) => candidate.entryId === entry.entryId);
  if (index === -1) return;
  queue[index] = entry;
  await writeQueue(queue);
}

/* ─── Файлы ──────────────────────────────────────────────────────────────── */

export async function putBlob(blob: Blob): Promise<string> {
  const key = crypto.randomUUID();
  await set(key, blob, blobStore);
  return key;
}

export async function takeBlob(key: string): Promise<Blob | null> {
  return (await get<Blob>(key, blobStore)) ?? null;
}

export async function dropBlob(key: string): Promise<void> {
  await del(key, blobStore);
}

/** Полная очистка — при выходе из аккаунта. */
export async function clearOutbox(): Promise<void> {
  const queue = await readQueue();
  await Promise.all(
    queue
      .filter((entry) => entry.op.kind === 'upload')
      .map((entry) => dropBlob((entry.op as { blobKey: string }).blobKey))
  );
  await writeQueue([]);
}
