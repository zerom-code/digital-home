import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Chip, InviteBlock } from '@/components/ui';
import type { Item, SmartPlug } from '@/lib/supabase/types';
import { livePowerW } from '@/lib/energy/measured';
import { usePlugs } from './usePlugs';
import { PlugSheet } from './PlugSheet';
import { PlugSetupSheet } from './PlugSetupSheet';

interface Props {
  householdId: string | null;
  items: Item[];
  canWrite: boolean;
}

const watts = (value: number) => `${Math.round(value).toLocaleString('ru-UA')} Вт`;
const kwh = (value: number) => (value < 10 ? value.toFixed(2) : value.toFixed(1));

/**
 * Розетки с ваттметром.
 *
 * Единственное место во всём экране, где числа не оценочные: здесь нет «≈»,
 * потому что это замер, а не расчёт (docs/03-energy.md).
 */
export function PlugsCard({ householdId, items, canWrite }: Props) {
  const { t } = useTranslation();
  const plugs = usePlugs(householdId);

  const [editing, setEditing] = useState<SmartPlug | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const now = new Date();
  const list = plugs.data ?? [];

  return (
    <>
      {list.length === 0 ? (
        <InviteBlock
          icon="🔌"
          title={t('plugs.emptyTitle')}
          text={t('plugs.emptyText')}
          action={
            canWrite && (
              <Button variant="secondary" onClick={() => setSetupOpen(true)}>
                {t('plugs.connect')}
              </Button>
            )
          }
        />
      ) : (
        <>
          <h2 className="mt-2 font-bold text-ink">{t('plugs.title')}</h2>
          <Card className="divide-y divide-line">
            {list.map((plug) => {
              const live = livePowerW(plug, now);
              const boundItem = items.find((item) => item.id === plug.item_id);

              return (
                <button
                  key={plug.id}
                  type="button"
                  onClick={() => canWrite && setEditing(plug)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">
                      {plug.name ?? t('plugs.unnamed')}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {boundItem ? boundItem.name : t('plugs.notBound')}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    {live === null ? (
                      <Chip tone="warn">{t('plugs.offline')}</Chip>
                    ) : (
                      <>
                        <span className="block font-semibold text-ink">{watts(live)}</span>
                        {plug.today_wh != null && (
                          <span className="text-xs text-ink-3">
                            {t('plugs.today', { kwh: kwh(plug.today_wh / 1000) })}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </Card>

          {canWrite && (
            <Button variant="ghost" onClick={() => setSetupOpen(true)}>
              {t('plugs.connectMore')}
            </Button>
          )}
        </>
      )}

      {householdId && (
        <>
          <PlugSheet
            open={editing !== null}
            onClose={() => setEditing(null)}
            plug={editing}
            items={items}
            householdId={householdId}
          />
          <PlugSetupSheet
            open={setupOpen}
            onClose={() => setSetupOpen(false)}
            householdId={householdId}
          />
        </>
      )}
    </>
  );
}
