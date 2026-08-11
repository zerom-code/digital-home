import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Input, Sheet, useToast } from '@/components/ui';
import { useReceiptScan, type ReceiptScanResult } from './useReceiptScan';

interface Props {
  open: boolean;
  onClose: () => void;
  householdId: string;
  /** Колбэк вызывается с извлеченными данными. Человек сам решает, что использовать. */
  onApply: (data: Partial<ReceiptScanResult>) => Promise<void>;
}

type Stage = 'pick' | 'scanning' | 'review';

/**
 * Фото чека → дата покупки, цена, продавец.
 *
 * Дата покупки — самое важное: из неё автоматически считается гарантия.
 * Цена и продавец заполняются для полноты, но могут быть отредактированы.
 */
export function ReceiptScanSheet({ open, onClose, householdId, onApply }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const scan = useReceiptScan();
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('pick');
  const [result, setResult] = useState<ReceiptScanResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage('pick');
    setResult(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;

    setPreview(URL.createObjectURL(file));
    setStage('scanning');

    try {
      const data = await scan.mutateAsync({
        file,
        householdId,
      });

      if (!data.purchase_date && !data.total_price && data.items.length === 0) {
        toast.show(t('ai.nothingFound'), { tone: 'danger' });
        setStage('pick');
        return;
      }

      setResult(data);
      setStage('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.show(message.includes('выключено') ? t('ai.disabled') : t('ai.failed'), {
        tone: 'danger',
      });
      setStage('pick');
    }
  }

  const handleSave = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await onApply({
        purchase_date: result.purchase_date,
        total_price: result.total_price,
        seller: result.seller,
        currency: result.currency,
      });
      reset();
      onClose();
      toast.show(t('ai.receiptApplied'));
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
      title={t('ai.receiptScanTitle')}
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
          <p className="text-ink-2">{t('ai.receiptHint')}</p>

          <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
            <p className="font-semibold text-ink">{t('ai.receiptTipTitle')}</p>
            <p className="mt-1 text-xs">{t('ai.receiptTip')}</p>
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

      {stage === 'review' && result && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await handleSave();
          }}
        >
          <div>
            <p className="text-sm font-medium text-ink mb-3">{t('ai.receiptExtracted')}</p>

            {result.purchase_date && (
              <div className="mb-3 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-ink">
                {t('ai.dateExtracted', { date: new Date(result.purchase_date).toLocaleDateString('ru-UA') })}
              </div>
            )}

            {result.items.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-ink-3 mb-2">{t('ai.itemsFound', { count: result.items.length })}</p>
                <ul className="space-y-1 text-xs">
                  {result.items.slice(0, 5).map((item, i) => (
                    <li key={i} className="text-ink-2">
                      {item.description}
                      {item.price != null && ` — ${item.price.toFixed(2)}`}
                    </li>
                  ))}
                  {result.items.length > 5 && (
                    <li className="text-ink-3">{t('ai.andMore', { count: result.items.length - 5 })}</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {result.purchase_date && (
              <Input
                label={t('item.purchasedAt')}
                type="date"
                value={result.purchase_date}
                readOnly
                className="text-ink-3"
              />
            )}

            {result.total_price != null && (
              <Input
                label={t('item.price')}
                type="number"
                step="0.01"
                value={result.total_price.toString()}
                readOnly
                className="text-ink-3"
              />
            )}

            {result.seller && (
              <Input
                label={t('item.seller')}
                value={result.seller}
                readOnly
                className="text-ink-3"
              />
            )}
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="secondary" block onClick={() => setStage('pick')}>
              {t('ai.retake')}
            </Button>
            <Button type="submit" block loading={busy} disabled={!result.purchase_date && !result.total_price}>
              {t('common.use')}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
