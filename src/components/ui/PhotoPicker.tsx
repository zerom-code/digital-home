import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  value: File | null;
  previewUrl?: string | null;
  onChange: (file: File | null) => void;
}

/** Больше 1600px по длинной стороне телефону не нужно, а трафик экономит. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Съёмка или выбор фотографии.
 *
 * capture="environment" на телефоне открывает камеру сразу, но остаётся
 * обычным file input, поэтому на десктопе работает выбор файла.
 *
 * Снимок ужимается до отправки: оригинал с современного телефона — это
 * 5–12 МБ, и на мобильном интернете он не загрузится никогда.
 */
export function PhotoPicker({ value, previewUrl, onChange }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const preview = localPreview ?? previewUrl ?? null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await shrink(file));
    } catch {
      // Не смогли ужать — отправим как есть, это лучше, чем потерять снимок
      onChange(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
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

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-busy={busy || undefined}
        className={
          'relative flex min-h-32 w-full items-center justify-center gap-2 overflow-hidden ' +
          'rounded-xl border border-dashed border-line-2 bg-surface-2 text-accent-ink ' +
          'active:brightness-95'
        }
      >
        {preview ? (
          <img src={preview} alt="" className="h-40 w-full object-cover" />
        ) : (
          <span className="flex items-center gap-2 font-semibold">
            <span aria-hidden="true">📷</span>
            {t('item.photo')}
          </span>
        )}
      </button>

      {preview && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="min-h-10 flex-1 rounded-lg border border-line text-sm text-ink-2 active:bg-surface-2"
          >
            {t('item.photoChange')}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="min-h-10 flex-1 rounded-lg border border-line text-sm text-danger active:bg-surface-2"
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Ужимает изображение через canvas. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  if (scale === 1 && file.size < 900_000) {
    bitmap.close();
    return file;
  }

  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}
