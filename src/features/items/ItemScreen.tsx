import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useActiveHousehold } from '@/features/household/useHousehold';
import { useCategories, useDeleteItem, useItem, useSpaces, useUpdateItem } from '@/features/home/useHomeData';
import { useSaveEnergyProfile } from '@/features/energy/useEnergy';
import { computeWarranty, describeWarranty } from '@/lib/warranty';
import type { Item } from '@/lib/supabase/types';
import { Button, Card, Chip, EmptyState, InviteBlock, Input, Select, Sheet, Spinner, Textarea, useToast } from '@/components/ui';
import { PageHeader } from '@/app/PageHeader';
import { DocumentsBlock } from '@/features/documents/DocumentsBlock';
import { NameplateSheet } from '@/features/ai/NameplateSheet';
import { ReceiptScanSheet } from '@/features/ai/ReceiptScanSheet';
import type { ReceiptScanResult } from '@/features/ai/useReceiptScan';
import { EnergyBlock } from '@/features/energy/EnergyBlock';
import { useSignedPhoto } from './ItemCard';

/**
 * Карточка вещи.
 *
 * Незаполненные блоки не прячутся, а показываются как приглашение с
 * конкретной выгодой: «Добавь дату покупки — посчитаю гарантию».
 */
export function ItemScreen() {
  const { itemId } = useParams<{ itemId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const { householdId, canWrite } = useActiveHousehold();
  const item = useItem(itemId);
  const categories = useCategories();
  const update = useUpdateItem(householdId);
  const saveEnergyProfile = useSaveEnergyProfile(householdId);
  const { remove, restore } = useDeleteItem(householdId);

  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<Partial<ReceiptScanResult> | null>(null);

  if (item.isLoading) return <Spinner label={t('common.loading')} />;
  if (!item.data) {
    return (
      <EmptyState
        icon="🤷"
        title={t('errors.notFound')}
        text={t('errors.notFoundHint')}
        action={<Button onClick={() => navigate('/')}>{t('errors.goHome')}</Button>}
      />
    );
  }

  const value = item.data;
  const category = categories.data?.find((row) => row.id === value.category_id) ?? null;
  const warranty = computeWarranty({
    purchased_at: value.purchased_at,
    warranty_months: value.warranty_months,
    warranty_until: value.warranty_until,
    categoryDefaultMonths: category?.default_warranty_months ?? null,
  });

  async function handleDelete() {
    const id = value.id;
    await remove.mutateAsync(id);
    navigate(-1);
    // Отмена вместо диалога подтверждения (ADR-011)
    toast.show(t('item.deleted'), {
      action: { label: t('common.undo'), onAction: () => void restore.mutate(id) },
    });
  }

  return (
    <div className="flex flex-col pb-8">
      <PageHeader
        title={value.name}
        action={
          canWrite && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-12 shrink-0 rounded-full px-4 font-semibold text-accent-ink active:bg-accent-soft"
            >
              {t('common.edit')}
            </button>
          )
        }
      />

      <Photo path={value.photo_path} />

      <div className="flex flex-col gap-4 px-4 pt-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-ink text-balance">{value.name}</h2>
          <p className="mt-1 text-ink-2">
            {[value.brand, value.model, category?.name_ru].filter(Boolean).join(' · ') || t('common.notSet')}
          </p>
          {value.status !== 'active' && (
            <div className="mt-2">
              <Chip tone={value.status === 'broken' ? 'danger' : 'neutral'}>
                {t(`item.status${value.status[0]!.toUpperCase()}${value.status.slice(1)}`)}
              </Chip>
            </div>
          )}
        </div>

        {/* Гарантия */}
        {warranty.state === 'unknown' ? (
          <InviteBlock
            icon="🛡"
            title={t('item.warrantyUnknownTitle')}
            text={t('item.warrantyUnknownText')}
            action={
              canWrite && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('item.warrantyAddDate')}
                </Button>
              )
            }
          />
        ) : (
          <Card className="flex flex-col gap-1 p-4">
            <div className="flex items-center gap-2">
              <span aria-hidden="true">🛡</span>
              <h3 className="font-semibold text-ink">{t('item.blockWarranty')}</h3>
            </div>
            <p
              className={
                warranty.state === 'expired'
                  ? 'text-danger'
                  : warranty.state === 'expiring'
                    ? 'text-warn'
                    : 'text-ink-2'
              }
            >
              {describeWarranty(warranty)}
            </p>
            <p className="text-xs text-ink-3">
              до {warranty.until}
              {warranty.estimated && ` · ${t('item.warrantyEstimated')}`}
            </p>
          </Card>
        )}

        {/* Распознавание таблички: восемь полей ручного ввода в один тап */}
        {canWrite && !value.model && (
          <InviteBlock
            icon="✨"
            title={t('ai.nameplateTitle')}
            text={t('ai.nameplateHint')}
            action={
              <Button variant="secondary" onClick={() => setScanning(true)}>
                📷 {t('ai.takePhoto')}
              </Button>
            }
          />
        )}

        <Facts item={value} />

        {householdId && (
          <DocumentsBlock itemId={value.id} householdId={householdId} canWrite={canWrite} />
        )}

        {/* Энергия: считаем сразу, как только у категории есть типовые
            значения — не дожидаясь, пока человек что-то заполнит */}
        <EnergyBlock
          itemId={value.id}
          householdId={householdId}
          categoryId={value.category_id}
          canWrite={canWrite}
        />

        {canWrite && (
          <Button variant="danger" block onClick={() => void handleDelete()}>
            {t('common.delete')}
          </Button>
        )}
      </div>

      {householdId && (
        <NameplateSheet
          open={scanning}
          onClose={() => setScanning(false)}
          householdId={householdId}
          onApply={async (patch, result) => {
            // Обновляем саму вещь: бренд, модель, серийник, категорию
            const newCategoryId = patch.category_id ?? value.category_id;
            await update.mutateAsync({ id: value.id, patch });

            // Сохраняем мощность в энергопрофиль, если она есть
            if (result.power_w && newCategoryId) {
              const targetCategory = categories.data?.find((c) => c.id === newCategoryId);
              const hoursPerDay = targetCategory?.default_hours_per_day ?? 4; // Типовое значение

              await saveEnergyProfile.mutateAsync({
                itemId: value.id,
                patch: {
                  mode: 'power_hours',
                  power_w: result.power_w,
                  hours_per_day: hoursPerDay,
                  source: 'ai_nameplate',
                  confidence: result.confidence,
                },
              });
            }
          }}
        />
      )}

      <EditSheet
        open={editing}
        onClose={() => setEditing(false)}
        item={value}
        householdId={householdId}
        receiptData={receiptData}
        onReceiptDataApplied={() => setReceiptData(null)}
        onReceiptScan={() => setScanningReceipt(true)}
        onSave={async (patch) => {
          await update.mutateAsync({ id: value.id, patch });
          setEditing(false);
        }}
      />

      {householdId && (
        <ReceiptScanSheet
          open={scanningReceipt}
          onClose={() => setScanningReceipt(false)}
          householdId={householdId}
          onApply={async (data) => {
            setReceiptData(data);
            setScanningReceipt(false);
          }}
        />
      )}
    </div>
  );
}

function Photo({ path }: { path: string | null }) {
  const url = useSignedPhoto(path);
  if (!url) return null;
  return <img src={url} alt="" className="aspect-4/3 w-full object-cover" />;
}

function Facts({ item }: { item: Item }) {
  const { t } = useTranslation();

  const rows: [string, string | null][] = [
    [t('item.serial'), item.serial_number],
    [t('item.purchasedAt'), item.purchased_at],
    [t('item.price'), item.price != null ? `${item.price} ${item.currency ?? 'UAH'}` : null],
    [t('item.seller'), item.seller],
    [t('item.notes'), item.notes],
  ];

  const filled = rows.filter(([, value]) => Boolean(value));
  if (filled.length === 0) return null;

  return (
    <Card className="divide-y divide-line">
      {filled.map(([label, value]) => (
        <div key={label} className="flex gap-4 px-4 py-3">
          <span className="w-32 shrink-0 text-sm text-ink-3">{label}</span>
          <span className="flex-1 text-ink">{value}</span>
        </div>
      ))}
    </Card>
  );
}

interface EditSheetProps {
  open: boolean;
  onClose: () => void;
  item: Item;
  householdId: string | null;
  receiptData: Partial<ReceiptScanResult> | null;
  onReceiptDataApplied: () => void;
  onReceiptScan: () => void;
  onSave: (patch: Partial<Item>) => Promise<void>;
}

function EditSheet({
  open,
  onClose,
  item,
  householdId,
  receiptData,
  onReceiptDataApplied,
  onReceiptScan,
  onSave,
}: EditSheetProps) {
  const { t } = useTranslation();
  const spaces = useSpaces(householdId);
  const categories = useCategories();

  const [form, setForm] = useState(() => ({
    name: item.name,
    brand: item.brand ?? '',
    model: item.model ?? '',
    serial_number: item.serial_number ?? '',
    category_id: item.category_id ?? '',
    space_id: item.space_id ?? '',
    purchased_at: item.purchased_at ?? '',
    price: item.price?.toString() ?? '',
    seller: item.seller ?? '',
    warranty_months: item.warranty_months?.toString() ?? '',
    status: item.status,
    notes: item.notes ?? '',
    guest_visible: item.guest_visible,
  }));
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const blank = (value: string) => (value.trim() === '' ? null : value.trim());

  // Применяем данные из чека, когда они становятся доступны
  useEffect(() => {
    if (!receiptData) return;

    if (receiptData.purchase_date) {
      set('purchased_at', receiptData.purchase_date);
    }
    if (receiptData.total_price != null) {
      set('price', receiptData.total_price.toString());
    }
    if (receiptData.seller) {
      set('seller', receiptData.seller);
    }

    onReceiptDataApplied();
  }, [receiptData, onReceiptDataApplied]);

  return (
    <Sheet open={open} onClose={onClose} title={t('common.edit')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSave({
              name: form.name.trim() || item.name,
              brand: blank(form.brand),
              model: blank(form.model),
              serial_number: blank(form.serial_number),
              category_id: blank(form.category_id),
              space_id: blank(form.space_id),
              purchased_at: blank(form.purchased_at),
              price: form.price.trim() ? Number(form.price) : null,
              seller: blank(form.seller),
              warranty_months: form.warranty_months.trim() ? Number(form.warranty_months) : null,
              status: form.status,
              notes: blank(form.notes),
              guest_visible: form.guest_visible,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input label={t('item.name')} value={form.name} onChange={(e) => set('name', e.target.value)} />

        <Select label={t('item.category')} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
          <option value="">{t('common.notSet')}</option>
          {(categories.data ?? [])
            .filter((category) => category.parent_id)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon ? `${category.icon}  ` : ''}
                {category.name_ru}
              </option>
            ))}
        </Select>

        <Select label={t('item.space')} value={form.space_id} onChange={(e) => set('space_id', e.target.value)}>
          <option value="">{t('item.spaceNone')}</option>
          {(spaces.data ?? []).map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </Select>

        <Input label={t('item.brand')} value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        <Input label={t('item.model')} value={form.model} onChange={(e) => set('model', e.target.value)} />
        <Input label={t('item.serial')} value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} />

        <div className="space-y-3">
          <Input
            label={t('item.purchasedAt')}
            type="date"
            value={form.purchased_at}
            onChange={(e) => set('purchased_at', e.target.value)}
          />
          {householdId && (
            <Button variant="secondary" block onClick={onReceiptScan}>
              📷 {t('ai.receiptScanTitle')}
            </Button>
          )}
        </div>

        <Input
          label={t('item.warrantyMonths')}
          type="number"
          inputMode="numeric"
          min={0}
          value={form.warranty_months}
          onChange={(e) => set('warranty_months', e.target.value)}
        />
        <Input
          label={t('item.price')}
          type="number"
          inputMode="decimal"
          min={0}
          value={form.price}
          onChange={(e) => set('price', e.target.value)}
        />
        <Input label={t('item.seller')} value={form.seller} onChange={(e) => set('seller', e.target.value)} />

        <Select
          label={t('item.status')}
          value={form.status}
          onChange={(e) => set('status', e.target.value as Item['status'])}
        >
          <option value="active">{t('item.statusActive')}</option>
          <option value="broken">{t('item.statusBroken')}</option>
          <option value="stored">{t('item.statusStored')}</option>
          <option value="sold">{t('item.statusSold')}</option>
          <option value="disposed">{t('item.statusDisposed')}</option>
        </Select>

        <Textarea label={t('item.notes')} value={form.notes} onChange={(e) => set('notes', e.target.value)} />

        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4">
          <input
            type="checkbox"
            className="size-5 accent-[var(--color-accent)]"
            checked={form.guest_visible}
            onChange={(e) => set('guest_visible', e.target.checked)}
          />
          <span className="flex flex-col">
            <span className="text-ink">{t('item.guestVisible')}</span>
            <span className="text-xs text-ink-3">{t('item.guestVisibleHint')}</span>
          </span>
        </label>

        <Button type="submit" size="lg" block loading={busy}>
          {t('common.save')}
        </Button>
      </form>
    </Sheet>
  );
}
