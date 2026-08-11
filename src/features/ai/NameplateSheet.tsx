import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCategories } from '@/features/home/useHomeData';
import type { Item } from '@/lib/supabase/types';
import { Button, Chip, Input, Sheet, useToast } from '@/components/ui';
import { hasAnything, useNameplateScan } from './useNameplate';
import type { NameplateResult } from './useNameplate';

interface Props {
  open: boolean;
  onClose: () => void;
  householdId: string;
  itemId: string;
  /** Подтверждённый черновик уходит в карточку, а не в базу напрямую */
  onApply: (patch: Partial<Item>, result: NameplateResult) => Promise<void>;
}

type Stage = 'pick' | 'scanning' | 'review';

/**
 * Фото шильдика → заполненная карточка.
 *
 * Человек не станет вводить модель, серийник и мощность руками — но
 * сфотографировать табличку готов. Именно в этом зазоре вся ценность
 * ИИ-слоя (docs/08-ai.md).
 */
export function NameplateSheet({ open, onClose, householdId, itemId, onApply }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const categories = useCategories();
  const scan = useNameplateScan();
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('pick');
  const [draft, setDraft] = useState<NameplateResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage('pick');
    setDraft(null);
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

      if (!hasAnything(result)) {
        toast.show(t('ai.nothingFound'), { tone: 'danger' });
        setStage('pick');
        return;
      }

      setDraft(result);
      setStage('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.show(message.includes('выключено') ? t('ai.disabled') : t('ai.failed'), {
        tone: 'danger',
      });
      setStage('pick');
    }
  }

  const set = <K extends keyof NameplateResult>(key: K, value: NameplateResult[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('ai.nameplateTitle')}
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
          <p className="text-ink-2">{t('ai.nameplateHint')}</p>

          <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
            <p className="font-semibold text-ink">{t('ai.whereTitle')}</p>
            <p className="mt-1">{t('ai.whereText')}</p>
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

      {stage === 'review' && draft && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await onApply(
                {
                  brand: draft.brand,
                  model: draft.model,
                  serial_number: draft.serial_number,
                  ...(draft.category_hint ? { category_id: draft.category_hint } : {}),
                },
                draft
              );
              reset();
              onClose();
              toast.show(t('ai.applied'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <Chip tone={draft.confidence === 'low' ? 'warn' : 'accent'}>
              ✨ {t(`ai.confidence.${draft.confidence}`)}
            </Chip>
            {draft.cached && <Chip>{t('ai.fromCache')}</Chip>}
          </div>

          <p className="text-sm text-ink-2">{t('ai.checkBeforeSaving')}</p>

          <Input
            label={`✨ ${t('item.brand')}`}
            value={draft.brand ?? ''}
            onChange={(event) => set('brand', event.target.value || null)}
          />
          <Input
            label={`✨ ${t('item.model')}`}
            value={draft.model ?? ''}
            onChange={(event) => set('model', event.target.value || null)}
          />
          <Input
            label={`✨ ${t('item.serial')}`}
            value={draft.serial_number ?? ''}
            onChange={(event) => set('serial_number', event.target.value || null)}
          />

          {draft.power_w != null && (
            <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-ink">
              {t('ai.powerFound', { power: draft.power_w })}
            </div>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" block onClick={() => setStage('pick')}>
              {t('ai.retake')}
            </Button>
            <Button type="submit" block loading={busy}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
