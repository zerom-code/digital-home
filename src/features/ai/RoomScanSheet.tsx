import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategories } from '@/features/home/useHomeData';
import type { Item } from '@/lib/supabase/types';
import { Button, Chip, Input, Sheet, useToast } from '@/components/ui';
import { useRoomScan, type RoomItem } from './useRoomScan';

interface Props {
  open: boolean;
  onClose: () => void;
  householdId: string;
  spaceId: string | null;
  /** Выбранные пользователем товары переводятся в карточки через этот коллбэк */
  onApply: (items: (Partial<Item> & { name: string })[]) => Promise<void>;
}

type Stage = 'pick' | 'scanning' | 'review';

/**
 * Фото комнаты → список техники для создания.
 *
 * Модель находит приборы и предлагает создать карточки.
 * Пользователь может снять галочки с лишних или отредактировать категорию.
 */
export function RoomScanSheet({ open, onClose, householdId, spaceId, onApply }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const categories = useCategories();
  const scan = useRoomScan();
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('pick');
  const [items, setItems] = useState<RoomItem[]>([]);
  const [selected, setSelected] = useState(new Set<number>());
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage('pick');
    setItems([]);
    setSelected(new Set());
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;

    setPreview(URL.createObjectURL(file));
    setStage('scanning');

    try {
      const result = await scan.mutateAsync({
        file,
        householdId,
        categories: categories.data ?? [],
      });

      if (!result.items || result.items.length === 0) {
        toast.show(t('ai.nothingFound'), { tone: 'danger' });
        setStage('pick');
        return;
      }

      setItems(result.items);
      // По умолчанию выбираем все найденные товары
      setSelected(new Set(result.items.map((_, i) => i)));
      setStage('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.show(message.includes('выключено') ? t('ai.disabled') : t('ai.failed'), {
        tone: 'danger',
      });
      setStage('pick');
    }
  }

  const toggleItem = (index: number) => {
    const newSelected = new Set(selected);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelected(newSelected);
  };

  const getItemCategory = (categoryId: string | null) => {
    if (!categoryId) return null;
    return categories.data?.find((c) => c.id === categoryId);
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const toCreate = Array.from(selected)
        .sort()
        .map((i) => {
          const item = items[i];
          return {
            name: item.name,
            // brand будет сохранён при редактировании карточки, сейчас не поддерживается
            category_id: item.category_id,
            space_id: spaceId,
          };
        });

      await onApply(toCreate);
      reset();
      onClose();
      toast.show(
        t('ai.itemsCreated', { count: toCreate.length }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('ai.roomScanTitle')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {stage === 'pick' && (
        <div className="flex flex-col gap-5">
          <p className="text-ink-2">{t('ai.roomScanHint')}</p>

          <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
            <p className="font-semibold text-ink">{t('ai.roomTipTitle')}</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              <li>{t('ai.roomTip1')}</li>
              <li>{t('ai.roomTip2')}</li>
              <li>{t('ai.roomTip3')}</li>
            </ul>
          </div>

          <Button size="lg" block onClick={() => inputRef.current?.click()}>
            📷 {t('ai.takePhoto')}
          </Button>

          <p className="text-xs text-ink-3">{t('ai.privacyNote')}</p>
        </div>
      )}

      {stage === 'scanning' && (
        <div className="flex flex-col items-center gap-4 py-6">
          {preview && <img src={preview} alt="" className="max-h-48 rounded-xl object-contain" />}
          <span className="size-8 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
          <p className="text-ink-2">{t('ai.scanning')}</p>
        </div>
      )}

      {stage === 'review' && items.length > 0 && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await handleSave();
          }}
        >
          <div>
            <p className="text-sm text-ink-2 mb-3">
              {t('ai.selectItems', { found: items.length, selected: selected.size })}
            </p>

            <ul className="space-y-2">
              {items.map((item, i) => {
                const category = getItemCategory(item.category_id);
                const isSelected = selected.has(i);

                return (
                  <li key={i}>
                    <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(i)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-ink">{item.name}</p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {category && (
                            <Chip size="sm" tone="accent">
                              {category.name_ru}
                            </Chip>
                          )}
                          {item.brand && (
                            <Chip size="sm" tone="neutral">
                              {item.brand}
                            </Chip>
                          )}
                          <Chip
                            size="sm"
                            tone={
                              item.confidence === 'high'
                                ? 'positive'
                                : item.confidence === 'medium'
                                  ? 'accent'
                                  : 'warn'
                            }
                          >
                            {t(`ai.confidence.${item.confidence}`)}
                          </Chip>
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="secondary" block onClick={() => setStage('pick')}>
              {t('ai.retake')}
            </Button>
            <Button
              type="submit"
              block
              loading={busy}
              disabled={selected.size === 0}
            >
              {t('ai.createItems', { count: selected.size })}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
