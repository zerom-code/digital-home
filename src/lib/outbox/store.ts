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

/**
 * Файл хранится как ArrayBuffer, а не как Blob.
 *
 * Safari (в том числе iOS) ненадёжно кладёт Blob в IndexedDB напрямую —
 * структурное клонирование зависает без ошибки и без результата. Кнопка
 * загрузки документа так и оставалась в состоянии «загружаю» навсегда: сама
 * запись о документе в базе уже создавалась, а вот `putBlob` за ней не
 * заканчивался никогда, и мутация не завершалась.
 *
 * ArrayBuffer через структурное клонирование в IndexedDB на Safari проходит
 * нормально — это и есть стандартный обход этого класса багов.
 */
interface StoredBlob {
  buffer: ArrayBuffer;
  type: string;
}

export async function putBlob(blob: Blob): Promise<string> {
  const key = crypto.randomUUID();
  const buffer = await blob.arrayBuffer();
  await set(key, { buffer, type: blob.type } satisfies StoredBlob, blobStore);
  return key;
}

export async function takeBlob(key: string): Promise<Blob | null> {
  const stored = await get<StoredBlob | Blob>(key, blobStore);
  if (!stored) return null;
  // Запись из очереди, поставленная до этого фикса, — там ещё лежит сырой
  // Blob старого формата. Читаем как есть, а не как {buffer, type}: там нет
  // .buffer, и мы бы отправили в хранилище файл из девяти байт текста
  // "undefined" вместо документа человека
  if (stored instanceof Blob) return stored;
  return new Blob([stored.buffer], { type: stored.type });
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
