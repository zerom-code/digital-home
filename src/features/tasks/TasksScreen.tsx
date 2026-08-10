import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useItems } from '@/features/home/useHomeData';
import type { Task } from '@/lib/supabase/types';
import { Button, Card, Chip, EmptyState, Input, Select, Sheet, Spinner, useToast } from '@/components/ui';
import { useCompleteTask, useCreateTask, useRefreshTasks, useTasks } from './useTasks';
import { BUCKET_ORDER, groupTasks } from '@/lib/tasks';
import type { Bucket } from '@/lib/tasks';

const SOURCE_ICON: Record<Task['source'], string> = {
  warranty: '🛡',
  maintenance: '🔧',
  consumable: '🔄',
  manual: '📌',
};

/**
 * Экран «Задачи».
 *
 * Почти ничего здесь не заводится руками: задачи приезжают из гарантий,
 * интервалов ТО и расходников. Человек их закрывает, а не пишет.
 */
export function TasksScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { householdId, canWrite } = useActiveHousehold();

  const tasks = useTasks(householdId);
  const refresh = useRefreshTasks(householdId);
  const { complete, reopen } = useCompleteTask(householdId);
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => groupTasks(tasks.data ?? []), [tasks.data]);
  const openCount = (tasks.data ?? []).filter((task) => task.status === 'open').length;

  if (tasks.isLoading) return <Spinner label={t('common.loading')} />;

  async function finish(task: Task) {
    await complete.mutateAsync(task.id);
    toast.show(t('tasks.done'), {
      action: { label: t('common.undo'), onAction: () => void reopen.mutate(task.id) },
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('tabs.tasks')}</h1>
        <button
          type="button"
          onClick={() => void refresh.mutate()}
          disabled={refresh.isPending}
          className="min-h-10 rounded-lg px-3 text-sm font-semibold text-accent-ink active:bg-accent-soft disabled:opacity-50"
        >
          {refresh.isPending ? t('common.loading') : t('tasks.refresh')}
        </button>
      </div>

      {openCount === 0 ? (
        <EmptyState
          icon="✅"
          title={t('tasks.emptyTitle')}
          text={t('tasks.emptyText')}
          action={canWrite && <Button onClick={() => setAdding(true)}>{t('tasks.add')}</Button>}
        />
      ) : (
        BUCKET_ORDER.filter((bucket) => bucket !== 'done').map((bucket) => {
          const list = groups.get(bucket);
          if (!list?.length) return null;

          return (
            <section key={bucket} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                {t(`tasks.bucket.${bucket}`)}
              </h2>
              <Card className="divide-y divide-line">
                {list.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    bucket={bucket}
                    canWrite={canWrite}
                    onComplete={() => void finish(task)}
                  />
                ))}
              </Card>
            </section>
          );
        })
      )}

      {(groups.get('done')?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            className="self-start text-sm font-semibold text-ink-3"
          >
            {showDone ? t('tasks.hideDone') : t('tasks.showDone', { count: groups.get('done')!.length })}
          </button>

          {showDone && (
            <Card className="divide-y divide-line opacity-70">
              {groups.get('done')!.map((task) => (
                <TaskRow key={task.id} task={task} bucket="done" canWrite={canWrite} />
              ))}
            </Card>
          )}
        </section>
      )}

      {canWrite && openCount > 0 && (
        <Button variant="secondary" block onClick={() => setAdding(true)}>
          {t('tasks.add')}
        </Button>
      )}

      <AddTaskSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function TaskRow({
  task,
  bucket,
  canWrite,
  onComplete,
}: {
  task: Task;
  bucket: Bucket;
  canWrite: boolean;
  onComplete?: () => void;
}) {
  const { t } = useTranslation();
  const done = task.status !== 'open';

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {canWrite && !done ? (
        <button
          type="button"
          onClick={onComplete}
          aria-label={t('tasks.complete')}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-line-2 active:bg-accent-soft"
        />
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink"
        >
          {done ? '✓' : SOURCE_ICON[task.source]}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-ink ${done ? 'line-through opacity-60' : ''}`}>{task.title}</span>

        {task.description && (
          <span className="text-sm text-ink-3">{task.description}</span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {bucket === 'overdue' && <Chip tone="danger">{t('tasks.bucket.overdue')}</Chip>}
          {task.interval_days && (
            <Chip>🔄 {t('tasks.everyDays', { count: task.interval_days })}</Chip>
          )}
          {task.item_id && (
            <Link to={`/item/${task.item_id}`} className="text-xs text-accent-ink underline">
              {t('tasks.openItem')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function AddTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { householdId } = useActiveHousehold();
  const items = useItems(householdId);
  const createTask = useCreateTask(householdId);

  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [interval, setInterval] = useState('');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Sheet open={open} onClose={onClose} title={t('tasks.addTitle')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) return;

          setBusy(true);
          try {
            await createTask.mutateAsync({
              title,
              due_at: dueAt ? new Date(dueAt).toISOString() : null,
              interval_days: interval ? Number(interval) : null,
              item_id: itemId || null,
            });
            setTitle('');
            setDueAt('');
            setInterval('');
            setItemId('');
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          label={t('tasks.titleLabel')}
          placeholder={t('tasks.titlePlaceholder')}
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <Input
          label={t('tasks.dueLabel')}
          type="date"
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
        />

        <Select
          label={t('tasks.repeatLabel')}
          value={interval}
          onChange={(event) => setInterval(event.target.value)}
          hint={t('tasks.repeatHint')}
        >
          <option value="">{t('tasks.repeatNever')}</option>
          <option value="30">{t('tasks.repeatMonth')}</option>
          <option value="90">{t('tasks.repeatQuarter')}</option>
          <option value="180">{t('tasks.repeatHalfYear')}</option>
          <option value="365">{t('tasks.repeatYear')}</option>
        </Select>

        <Select
          label={t('tasks.itemLabel')}
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
        >
          <option value="">{t('tasks.itemNone')}</option>
          {(items.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        <Button type="submit" size="lg" block loading={busy} disabled={!title.trim()}>
          {t('common.done')}
        </Button>
      </form>
    </Sheet>
  );
}
