import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Sheet, useToast } from '@/components/ui';
import type { Item, SmartPlug } from '@/lib/supabase/types';
import { useUpdatePlug } from './usePlugs';

interface Props {
  open: boolean;
  onClose: () => void;
  plug: SmartPlug | null;
  items: Item[];
  householdId: string;
}

/**
 * Настройка розетки: как называется и что в неё воткнуто.
 *
 * Привязка к вещи — это весь смысл: пока розетка ни с чем не связана, её
 * замер остаётся отдельным числом, а связанный превращает оценку вещи в факт
 * (docs/03-energy.md).
 */
export function PlugSheet({ open, onClose, plug, items, householdId }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdatePlug(householdId);

  const [name, setName] = useState('');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);

  // Лист переиспользуется для разных розеток, поэтому поля заполняем при
  // каждом открытии, а не один раз в useState
  useEffect(() => {
    if (!open || !plug) return;
    setName(plug.name ?? '');
    setItemId(plug.item_id ?? '');
  }, [open, plug]);

  if (!plug) return null;

  return (
    <Sheet open={open} onClose={onClose} title={t('plugs.settings')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await update.mutateAsync({
              id: plug.id,
              patch: {
                name: name.trim() || null,
                item_id: itemId || null,
              },
            });
            toast.show(t('common.saved'));
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          label={t('plugs.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint={t('plugs.nameHint')}
        />

        <Select
          label={t('plugs.boundItem')}
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          hint={t('plugs.boundItemHint')}
        >
          <option value="">{t('plugs.notBound')}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>

        <div className="rounded-xl bg-surface-2 px-4 py-3 text-xs text-ink-3">
          <p>{t('plugs.deviceId', { id: plug.device_id })}</p>
          {plug.last_seen_at && (
            <p className="mt-1">
              {t('plugs.lastSeen', {
                when: new Date(plug.last_seen_at).toLocaleString('ru-UA'),
              })}
            </p>
          )}
        </div>

        <Button type="submit" size="lg" block loading={busy}>
          {t('common.save')}
        </Button>

        {/* Мягкое удаление: мост, увидев розетку снова, заведёт её заново —
            поэтому «забыть» честнее называть отвязкой, чем удалением */}
        <Button
          type="button"
          variant="danger"
          block
          onClick={async () => {
            setBusy(true);
            try {
              await update.mutateAsync({
                id: plug.id,
                patch: { deleted_at: new Date().toISOString() },
              });
              toast.show(t('plugs.forgotten'));
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('plugs.forget')}
        </Button>
      </form>
    </Sheet>
  );
}
