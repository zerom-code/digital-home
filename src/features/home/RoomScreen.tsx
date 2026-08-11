import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useItems, useSpaces, useCreateItem } from './useHomeData';
import { groupBySpace, flattenItems } from '@/lib/tree';
import { ItemTile } from '@/features/items/ItemCard';
import { AddItemSheet } from '@/features/items/AddItemSheet';
import { RoomScanSheet } from '@/features/ai/RoomScanSheet';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { PageHeader } from '@/app/PageHeader';

export function RoomScreen() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { t } = useTranslation();
  const { householdId, canWrite } = useActiveHousehold();

  const spaces = useSpaces(householdId);
  const items = useItems(householdId);
  const create = useCreateItem(householdId);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  const isOrphans = spaceId === 'none';

  const group = useMemo(() => {
    const groups = groupBySpace(spaces.data ?? [], items.data ?? []);
    return isOrphans
      ? groups.find((candidate) => candidate.space === null)
      : groups.find((candidate) => candidate.space?.id === spaceId);
  }, [spaces.data, items.data, spaceId, isOrphans]);

  if (spaces.isLoading || items.isLoading) return <Spinner label={t('common.loading')} />;

  const title = isOrphans ? t('home.noRoom') : group?.space?.name ?? t('errors.notFound');
  const visible = group ? flattenItems(group) : [];

  return (
    <div className="flex flex-col">
      <PageHeader title={title} icon={group?.space?.icon ?? (isOrphans ? '📦' : undefined)} />

      <div className="px-4 pb-6">
        {visible.length === 0 ? (
          <EmptyState
            icon="📦"
            title={t('room.emptyTitle')}
            text={t('room.emptyText')}
            action={
              canWrite && (
                <div className="flex gap-2">
                  <Button onClick={() => setAdding(true)}>{t('common.add')}</Button>
                  <Button variant="secondary" onClick={() => setScanning(true)}>
                    📷 {t('ai.roomScanTitle')}
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((item) => (
              <ItemTile key={item.id} item={item} />
            ))}

            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-2 text-ink-2 active:bg-surface-2"
                >
                  <span className="text-2xl" aria-hidden="true">➕</span>
                  <span className="text-sm font-medium">{t('common.add')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-2 text-ink-2 active:bg-surface-2"
                >
                  <span className="text-2xl" aria-hidden="true">📷</span>
                  <span className="text-sm font-medium">{t('ai.roomScanTitle')}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <AddItemSheet
        open={adding}
        onClose={() => setAdding(false)}
        defaultSpaceId={isOrphans ? null : spaceId ?? null}
      />

      {householdId && (
        <RoomScanSheet
          open={scanning}
          onClose={() => setScanning(false)}
          householdId={householdId}
          spaceId={isOrphans ? null : spaceId ?? null}
          onApply={async (itemsToCreate) => {
            // Создаём карточки в параллель
            await Promise.all(
              itemsToCreate.map((item) =>
                create.mutateAsync({
                  name: item.name,
                  space_id: item.space_id,
                  category_id: item.category_id,
                })
              )
            );
            setScanning(false);
          }}
        />
      )}
    </div>
  );
}
