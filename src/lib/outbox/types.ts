/**
 * Очередь офлайн-записи.
 *
 * Модель простая: клиент складывает намерения («создай вещь», «поправь поле»,
 * «загрузи фото»), а воркер отправляет их, когда появляется сеть.
 *
 * Хранилище — idb-keyval, а не Dexie: очередь домашнего инвентаря живёт
 * десятками записей, а не тысячами, и полноценная база на клиенте здесь
 * только добавила бы зависимость (ADR-015).
 */

/** Таблицы, которые клиент правит напрямую. */
export type SyncTable = 'items' | 'spaces' | 'homes' | 'tasks' | 'documents' | 'consumables';

export interface UpsertOp {
  kind: 'upsert';
  table: SyncTable;
  /** id генерирует клиент, поэтому повтор отправки идемпотентен */
  id: string;
  payload: Record<string, unknown>;
}

export interface UpdateOp {
  kind: 'update';
  table: SyncTable;
  id: string;
  patch: Record<string, unknown>;
}

/** Удаление всегда мягкое: ставим deleted_at, чтобы работала «Отмена». */
export interface DeleteOp {
  kind: 'delete';
  table: SyncTable;
  id: string;
}

export interface UploadOp {
  kind: 'upload';
  bucket: 'docs';
  path: string;
  /** Ключ, по которому Blob лежит в IndexedDB */
  blobKey: string;
  contentType: string;
  /** Что обновить после успешной загрузки: items.photo_path и т.п. */
  attachTo?: { table: SyncTable; id: string; column: string };
}

export type Operation = UpsertOp | UpdateOp | DeleteOp | UploadOp;

export interface Entry {
  /** Идентификатор записи очереди, не строки в базе */
  entryId: string;
  op: Operation;
  createdAt: number;
  attempts: number;
  /** Когда можно пробовать снова (экспоненциальный откат) */
  nextAttemptAt: number;
  lastError?: string;
}

export type EntryState = 'pending' | 'stuck';

/** Сколько раз пробуем, прежде чем отложить запись и рассказать человеку. */
export const MAX_ATTEMPTS = 5;

/** Откат: 2с, 8с, 30с, 2мин, 10мин. */
export const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000, 600_000];

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 600_000;
}
