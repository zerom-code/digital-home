import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useItems, useSpaces } from '@/features/home/useHomeData';
import { searchItems } from '@/lib/search';
import { ItemTile } from '@/features/items/ItemCard';
import { EmptyState, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/app/PageHeader';

/**
 * Поиск по дому.
 *
 * Ищем локально по уже загруженным вещам: так результат появляется по мере
 * набора и работает офлайн. Серверный RPC search_items нужен, когда вещей
 * станет столько, что грузить их все перестанет иметь смысл.
 */
export function SearchScreen() {
  const { t } = useTranslation();
  const { householdId } = useActiveHousehold();

  const items = useItems(householdId);
  const spaces = useSpaces(householdId);
  const [query, setQuery] = useState('');

  const results = useMemo(
    () => searchItems(items.data ?? [], query),
    [items.data, query]
  );

  const spaceName = useMemo(() => {
    const map = new Map<string, string>();
    for (const space of spaces.data ?? []) {
      if (space.name) map.set(space.id, space.name);
    }
    return map;
  }, [spaces.data]);

  return (
    <div className="flex flex-col">
      <PageHeader title={t('search.title')} />

      <div className="flex flex-col gap-4 px-4 pb-6 pt-3">
        <Input
          autoFocus
          type="search"
          inputMode="search"
          placeholder={t('search.placeholder')}
          hint={query ? undefined : t('search.hint')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {items.isLoading && <Spinner />}

        {!items.isLoading && query.trim() !== '' && results.length === 0 && (
          <EmptyState icon="🔍" title={t('search.nothingTitle')} text={t('search.nothingText')} />
        )}

        {results.length > 0 && (
          <>
            <p className="text-sm text-ink-3">
              {t('search.resultCount', { count: results.length })}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {results.map((item) => (
                <div key={item.id} className="flex flex-col gap-1">
                  <ItemTile item={item} />
                  {item.space_id && spaceName.has(item.space_id) && (
                    <span className="px-1 text-xs text-ink-3">
                      {spaceName.get(item.space_id)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
