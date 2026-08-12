import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { signedUrl } from '@/lib/supabase/client';
import type { DocumentKind, ItemDocument } from '@/lib/supabase/types';
import { Button, Card, Chip, InviteBlock, Input, Select, Sheet, useToast } from '@/components/ui';
import { useAddDocument, useDeleteDocument, useDocuments } from './useDocuments';

const KIND_ICON: Record<DocumentKind, string> = {
  manual: '📘',
  receipt: '🧾',
  warranty: '🛡',
  photo: '🖼',
  contract: '📄',
  other: '📎',
};

export function DocumentsBlock({
  itemId,
  householdId,
  canWrite,
}: {
  itemId: string;
  householdId: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const documents = useDocuments(itemId);
  const { remove, restore } = useDeleteDocument(itemId);
  const [adding, setAdding] = useState(false);

  const list = documents.data ?? [];

  if (list.length === 0) {
    return (
      <>
        <InviteBlock
          icon="📄"
          title={t('item.documentsEmptyTitle')}
          text={t('item.documentsEmptyText')}
          action={
            canWrite && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {t('documents.add')}
              </Button>
            )
          }
        />
        <AddDocumentSheet
          open={adding}
          onClose={() => setAdding(false)}
          itemId={itemId}
          householdId={householdId}
        />
      </>
    );
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <span aria-hidden="true">📄</span>
            {t('item.blockDocuments')}
          </h3>
          {canWrite && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="min-h-10 rounded-lg px-3 text-sm font-semibold text-accent-ink active:bg-accent-soft"
            >
              {t('common.add')}
            </button>
          )}
        </div>

        <ul className="divide-y divide-line">
          {list.map((document) => (
            <li key={document.id}>
              <DocumentRow
                document={document}
                canWrite={canWrite}
                onDelete={async () => {
                  await remove.mutateAsync(document.id);
                  toast.show(t('documents.deleted'), {
                    action: {
                      label: t('common.undo'),
                      onAction: () => void restore.mutate(document.id),
                    },
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </Card>

      <AddDocumentSheet
        open={adding}
        onClose={() => setAdding(false)}
        itemId={itemId}
        householdId={householdId}
      />
    </>
  );
}

function DocumentRow({
  document,
  canWrite,
  onDelete,
}: {
  document: ItemDocument;
  canWrite: boolean;
  onDelete: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  async function open() {
    if (document.external_url) {
      window.open(document.external_url, '_blank', 'noopener');
      return;
    }
    if (!document.storage_path) return;

    // window.open обязан быть прямым следствием клика — вызванный после
    // await, он для Safari (особенно в установленном PWA) уже не «клик
    // пользователя», а всплывающее окно, и блокируется молча. Поэтому
    // открываем вкладку сразу, синхронно, а адрес подставляем, когда
    // подписанная ссылка будет готова. noopener здесь не ставим намеренно:
    // с ним window.open вернул бы null, и подставить адрес было бы некуда —
    // ссылка ведёт на наше собственное хранилище, а не на чужой сайт
    const tab = window.open('', '_blank');

    setOpening(true);
    const url = await signedUrl(document.storage_path);
    setOpening(false);

    if (url && tab) {
      tab.location.href = url;
    } else {
      tab?.close();
      // Файл мог ещё не долиться из офлайн-очереди — это не «сломано»,
      // а «подожди» (docs/05-architecture.md), но молчать нельзя: до этого
      // человек просто не понимал, почему ничего не открывается
      toast.show(t('documents.openFailed'), { tone: 'danger' });
    }
  }

  const pending = !document.external_url && !document.storage_path;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className="text-xl">
        {KIND_ICON[document.kind ?? 'other']}
      </span>

      <button
        type="button"
        onClick={() => void open()}
        disabled={pending || opening}
        className="flex-1 text-left disabled:opacity-60"
      >
        <span className="block text-ink">{document.title ?? t('documents.untitled')}</span>
        <span className="block text-xs text-ink-3">
          {t(`documents.kind.${document.kind ?? 'other'}`)}
          {document.external_url && ' · ссылка'}
        </span>
      </button>

      {pending && <Chip tone="warn">{t('documents.uploading')}</Chip>}

      {canWrite && (
        <button
          type="button"
          onClick={() => void onDelete()}
          aria-label={t('common.delete')}
          className="flex size-10 items-center justify-center rounded-full text-ink-3 active:bg-surface-2"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}

function AddDocumentSheet({
  open,
  onClose,
  itemId,
  householdId,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  householdId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const addDocument = useAddDocument();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<DocumentKind>('manual');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = Boolean(file || url.trim());

  return (
    <Sheet open={open} onClose={onClose} title={t('documents.addTitle')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit) return;

          setBusy(true);
          try {
            await addDocument.mutateAsync({
              itemId,
              householdId,
              kind,
              title,
              file,
              externalUrl: url,
            });
            setTitle('');
            setUrl('');
            setFile(null);
            onClose();
            toast.show(file ? t('documents.queued') : t('documents.added'));
          } catch {
            toast.show(t('errors.generic'), { tone: 'danger' });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Select
          label={t('documents.kindLabel')}
          value={kind}
          onChange={(event) => setKind(event.target.value as DocumentKind)}
        >
          {(Object.keys(KIND_ICON) as DocumentKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_ICON[value]}  {t(`documents.kind.${value}`)}
            </option>
          ))}
        </Select>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-2 bg-surface-2 text-accent-ink active:brightness-95"
        >
          <span aria-hidden="true" className="text-2xl">📎</span>
          <span className="font-semibold">{file ? file.name : t('documents.pickFile')}</span>
          {file && (
            <span className="text-xs text-ink-3">
              {(file.size / 1024 / 1024).toFixed(1)} МБ
            </span>
          )}
        </button>

        <div className="flex items-center gap-3 text-sm text-ink-3">
          <span className="h-px flex-1 bg-line" />
          {t('auth.or')}
          <span className="h-px flex-1 bg-line" />
        </div>

        <Input
          label={t('documents.urlLabel')}
          type="url"
          inputMode="url"
          placeholder="https://…"
          hint={t('documents.urlHint')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />

        <Input
          label={t('documents.titleLabel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={file?.name ?? t('documents.titlePlaceholder')}
        />

        <Button type="submit" size="lg" block loading={busy} disabled={!canSubmit}>
          {t('common.done')}
        </Button>
      </form>
    </Sheet>
  );
}
