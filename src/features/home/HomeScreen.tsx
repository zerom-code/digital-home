import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useHomes, useItems, useSpaces, useCreateSpace } from './useHomeData';
import { groupBySpace, expiringSoon } from '@/lib/tree';
import type { SpaceGroup } from '@/lib/tree';
import type { Item, Space } from '@/lib/supabase/types';
import { Button, Chip, EmptyState, Input, Select, Sheet, Spinner } from '@/components/ui';

const ROOM_KINDS: { value: string; label: string; icon: string }[] = [
  { value: 'kitchen', label: 'Кухня', icon: '🍳' },
  { value: 'living', label: 'Гостиная', icon: '🛋' },
  { value: 'bedroom', label: 'Спальня', icon: '🛏' },
  { value: 'bath', label: 'Ванная', icon: '🛁' },
  { value: 'hallway', label: 'Прихожая', icon: '🚪' },
  { value: 'balcony', label: 'Балкон', icon: '🌤' },
  { value: 'storage', label: 'Кладовая', icon: '📦' },
  { value: 'garage', label: 'Гараж', icon: '🚗' },
  { value: 'other', label: 'Другое', icon: '🏠' },
];

/**
 * Главный экран.
 *
 * Не файловый менеджер, а крупные карточки комнат: человек узнаёт свою
 * кухню по иконке и числу вещей быстрее, чем читает список путей.
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { householdId, canWrite } = useActiveHousehold();

  const spaces = useSpaces(householdId);
  const items = useItems(householdId);
  const homes = useHomes(householdId);
  const createSpace = useCreateSpace(householdId);

  const [adding, setAdding] = useState(false);

  const groups = useMemo(
    () => groupBySpace(spaces.data ?? [], items.data ?? []),
    [spaces.data, items.data]
  );

  if (spaces.isLoading || items.isLoading) {
    return <Spinner label={t('common.loading')} />;
  }

  const hasNothing = groups.length === 0;

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
      <button
        type="button"
        onClick={() => navigate('/search')}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-ink-3 active:bg-surface-2"
      >
        <span aria-hidden="true">🔍</span>
        {t('common.search')}
      </button>

      {hasNothing ? (
        <EmptyState
          icon="🏠"
          title={t('home.emptyTitle')}
          text={t('home.emptyText')}
          action={
            canWrite && (
              <Button onClick={() => setAdding(true)}>{t('home.addRoom')}</Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {groups.map((group) => (
            <RoomCard key={group.space?.id ?? 'orphans'} group={group} />
          ))}

          {canWrite && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-2 text-ink-2 active:bg-surface-2"
            >
              <span className="text-2xl" aria-hidden="true">➕</span>
              <span className="text-sm font-medium">{t('home.addRoom')}</span>
            </button>
          )}
        </div>
      )}

      <AddRoomSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={async (name, kind, icon) => {
          await createSpace.mutateAsync({
            name,
            kind,
            icon,
            home_id: homes.data?.[0]?.id ?? null,
          });
          setAdding(false);
        }}
      />
    </div>
  );
}

function RoomCard({ group }: { group: SpaceGroup<Space, Item> }) {
  const { t } = useTranslation();
  const alerts = expiringSoon(group);
  const target = group.space ? `/room/${group.space.id}` : '/room/none';

  return (
    <Link
      to={target}
      className="flex min-h-32 flex-col justify-between rounded-card border border-line bg-surface p-4 active:bg-surface-2"
    >
      <span className="text-3xl" aria-hidden="true">
        {group.space?.icon ?? '📦'}
      </span>

      <div className="mt-2 flex flex-col gap-1.5">
        <span className="font-semibold text-ink">
          {group.space?.name ?? t('home.noRoom')}
        </span>
        <span className="text-sm text-ink-3">
          {t('home.itemCount', { count: group.totalItems })}
        </span>
        {alerts.length > 0 && (
          <Chip tone="warn">⚠ {t('home.warrantyAlert', { count: alerts.length })}</Chip>
        )}
      </div>
    </Link>
  );
}

function AddRoomSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, kind: string, icon: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('kitchen');
  const [busy, setBusy] = useState(false);

  const preset = ROOM_KINDS.find((option) => option.value === kind) ?? ROOM_KINDS[0]!;

  return (
    <Sheet open={open} onClose={onClose} title={t('room.newTitle')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onCreate(name.trim() || preset.label, kind, preset.icon);
            setName('');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select
          label={t('room.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {ROOM_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.icon}  {option.label}
            </option>
          ))}
        </Select>

        <Input
          label={t('room.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={preset.label}
        />

        <Button type="submit" size="lg" block loading={busy}>
          {t('common.done')}
        </Button>
      </form>
    </Sheet>
  );
}
