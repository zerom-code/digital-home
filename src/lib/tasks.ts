/**
 * Раскладка задач по срочности.
 *
 * Чистая логика: живёт в lib/, а не рядом с запросами, чтобы её можно было
 * покрыть тестами без поднятия react-query и клиента Supabase.
 */

export interface TaskLike {
  status: 'open' | 'done' | 'skipped';
  due_at: string | null;
}

export type Bucket = 'overdue' | 'today' | 'soon' | 'later' | 'done';

export const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'soon', 'later', 'done'];

/**
 * Просроченное отделяем от «когда-нибудь» отдельной группой: смешанное с
 * остальным, оно перестаёт читаться как требующее внимания.
 *
 * Задача без срока — это «потом», а не «просрочено»: человек завёл
 * напоминание, но не обещал сделать его к дате.
 */
export function bucketOf(task: TaskLike, now: Date = new Date()): Bucket {
  if (task.status !== 'open') return 'done';
  if (!task.due_at) return 'later';

  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return 'later';

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const inAWeek = new Date(startOfToday);
  inAWeek.setDate(inAWeek.getDate() + 7);

  if (due < startOfToday) return 'overdue';
  if (due < endOfToday) return 'today';
  if (due < inAWeek) return 'soon';
  return 'later';
}

/** Группы создаются только непустые — иначе экран заполнится заголовками. */
export function groupTasks<T extends TaskLike>(tasks: T[], now: Date = new Date()): Map<Bucket, T[]> {
  const groups = new Map<Bucket, T[]>();

  for (const task of tasks) {
    const bucket = bucketOf(task, now);
    const list = groups.get(bucket);
    if (list) list.push(task);
    else groups.set(bucket, [task]);
  }

  return groups;
}
