import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useCreateItem, useHomes, useSpaces } from '@/features/home/useHomeData';
import { Button, Input, PhotoPicker, Select, Sheet, useToast } from '@/components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Комната, из которой открыли — подставляется сразу */
  defaultSpaceId?: string | null;
}

/**
 * Добавление вещи за 30 секунд.
 *
 * Одно поле, камера и выбор комнаты. Кнопка «Готово» активна с первого
 * введённого символа: всё остальное — необязательный следующий шаг, а не
 * условие сохранения (ADR-006).
 */
export function AddItemSheet({ open, onClose, defaultSpaceId = null }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const { householdId } = useActiveHousehold();
  const spaces = useSpaces(householdId);
  const homes = useHomes(householdId);
  const createItem = useCreateItem(householdId);

  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName('');
    setPhoto(null);
    setSpaceId(defaultSpaceId ?? '');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setBusy(true);
    try {
      const item = await createItem.mutateAsync({
        name,
        space_id: spaceId || null,
        home_id: homes.data?.[0]?.id ?? null,
        photo,
      });

      reset();
      onClose();
      toast.show(t('item.created'));
      // Сразу открываем карточку: дальше можно дозаполнить, а можно не
      // дозаполнять — но человек видит, что вещь появилась
      navigate(`/item/${item.id}`);
    } catch {
      toast.show(navigator.onLine ? t('errors.generic') : t('errors.offline'), {
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('item.newTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Input
          label={t('item.name')}
          placeholder={t('item.namePlaceholder')}
          hint={t('item.nameHint')}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <PhotoPicker value={photo} onChange={setPhoto} />

        <Select
          label={t('item.space')}
          value={spaceId}
          onChange={(event) => setSpaceId(event.target.value)}
        >
          <option value="">{t('item.spaceNone')}</option>
          {(spaces.data ?? []).map((space) => (
            <option key={space.id} value={space.id}>
              {space.icon ? `${space.icon}  ` : ''}
              {space.name}
            </option>
          ))}
        </Select>

        <Button type="submit" size="lg" block loading={busy} disabled={!name.trim()}>
          {t('common.done')}
        </Button>
      </form>
    </Sheet>
  );
}
