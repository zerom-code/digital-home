import type { Entry, Operation, SyncTable } from './types';
import { MAX_ATTEMPTS, backoffFor } from './types';

/**
 * Чистая логика очереди: сжатие, порядок, откат при ошибках.
 *
 * Вынесена отдельно от хранилища и от сети, чтобы её можно было целиком
 * покрыть тестами — а это самая коварная часть офлайна.
 */

function key(op: Operation): string {
  return op.kind === 'upload' ? `upload:${op.path}` : `${op.table}:${op.id}`;
}

/**
 * Сжимает очередь перед отправкой.
 *
 * Пока телефон был офлайн, человек мог десять раз переименовать вещь, а
 * потом её удалить. Отправлять всё это по очереди бессмысленно и медленно.
 *
 * Правила:
 *   — несколько update по одной строке сливаются в один patch;
 *   — delete после create означает, что строки на сервере не было вовсе:
 *     ни то ни другое отправлять не нужно;
 *   — delete поверх update отменяет накопленные правки;
 *   — upload остаётся отдельной записью: файл большой и может не дойти,
 *     когда остальное уже ушло.
 */
export function compact(entries: Entry[]): Entry[] {
  const result: Entry[] = [];
  const index = new Map<string, number>();

  for (const entry of entries) {
    const op = entry.op;

    if (op.kind === 'upload') {
      result.push(entry);
      continue;
    }

    const id = key(op);
    const existingIndex = index.get(id);

    if (existingIndex === undefined) {
      index.set(id, result.length);
      result.push(entry);
      continue;
    }

    const existing = result[existingIndex]!;
    const previous = existing.op;

    if (op.kind === 'delete') {
      if (previous.kind === 'upsert') {
        // Создали и удалили, не выходя в сеть — сервер об этом не узнает.
        // Заодно снимаем связанные загрузки: файл больше некуда прикреплять
        result[existingIndex] = null as unknown as Entry;
        for (let i = 0; i < result.length; i++) {
          const candidate = result[i];
          if (
            candidate?.op.kind === 'upload' &&
            candidate.op.attachTo &&
            candidate.op.attachTo.id === op.id
          ) {
            result[i] = null as unknown as Entry;
          }
        }
        index.delete(id);
      } else {
        result[existingIndex] = { ...existing, op };
      }
      continue;
    }

    if (op.kind === 'update' && previous.kind === 'update') {
      result[existingIndex] = {
        ...existing,
        op: { ...previous, patch: { ...previous.patch, ...op.patch } },
      };
      continue;
    }

    if (op.kind === 'update' && previous.kind === 'upsert') {
      // Строку ещё не создали на сервере — правку вливаем прямо в создание
      result[existingIndex] = {
        ...existing,
        op: { ...previous, payload: { ...previous.payload, ...op.patch } },
      };
      continue;
    }

    if (op.kind === 'upsert' && previous.kind === 'delete') {
      // Восстановили после удаления: отправляем создание заново
      result[existingIndex] = { ...existing, op };
      continue;
    }

    result[existingIndex] = { ...existing, op };
  }

  return result.filter(Boolean);
}

/** Записи, до которых дошёл срок повторной попытки. */
export function due(entries: Entry[], now: number): Entry[] {
  return entries.filter((entry) => entry.attempts < MAX_ATTEMPTS && entry.nextAttemptAt <= now);
}

/** Записи, которые исчерпали попытки: их показываем человеку. */
export function stuck(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.attempts >= MAX_ATTEMPTS);
}

/**
 * Отмечает неудачу.
 *
 * Ошибка 4xx означает, что повтор не поможет: сервер отказал по существу
 * (нет прав, нарушено ограничение). Такую запись сразу считаем застрявшей,
 * а не долбим пять раз подряд.
 */
export function markFailed(entry: Entry, error: string, now: number, permanent = false): Entry {
  const attempts = permanent ? MAX_ATTEMPTS : entry.attempts + 1;
  return {
    ...entry,
    attempts,
    lastError: error,
    nextAttemptAt: now + backoffFor(entry.attempts),
  };
}

export function isPermanent(status: number | undefined): boolean {
  if (status === undefined) return false;
  // 408 и 429 — временные, остальные 4xx повторять бессмысленно
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** Сводка для интерфейса: сколько ждёт отправки и сколько застряло. */
export function summarize(entries: Entry[]): { pending: number; stuck: number } {
  const blocked = stuck(entries).length;
  return { pending: entries.length - blocked, stuck: blocked };
}

/** Порядок отправки: сначала старое, чтобы не переставлять причинность. */
export function ordered(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt);
}

export function tablesTouched(entries: Entry[]): SyncTable[] {
  const tables = new Set<SyncTable>();
  for (const entry of entries) {
    if (entry.op.kind === 'upload') {
      if (entry.op.attachTo) tables.add(entry.op.attachTo.table);
    } else {
      tables.add(entry.op.table);
    }
  }
  return [...tables];
}
