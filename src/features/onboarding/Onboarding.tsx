import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { useCreateHousehold } from '@/features/household/useHousehold';
import { Button, Card, Input } from '@/components/ui';
import templatesData from '../../../data/apartment-templates.json';

interface TemplateRoom {
  name: string;
  kind: string;
  icon: string;
  items: { name: string; category_id: string }[];
}

interface Template {
  id: string;
  name: string;
  icon: string;
  homeKind: string;
  rooms: TemplateRoom[];
}

const templates = templatesData.templates as Template[];

type Step = 'welcome' | 'name' | 'template' | 'done';

/**
 * Онбординг: не больше четырёх экранов.
 *
 * Цель — довести до первой заполненной комнаты, а не рассказать о
 * возможностях. Шаблон квартиры — главный выигрыш: шесть тапов, и дальше
 * человек правит готовое, а не создаёт с нуля (docs/04-ux.md).
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createHousehold = useCreateHousehold();

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function build(template: Template | null) {
    setBusy(true);
    try {
      const householdId = await createHousehold.mutateAsync(name.trim() || 'Квартира');

      const { data: home } = await supabase
        .from('homes')
        .insert({
          household_id: householdId,
          name: name.trim() || 'Квартира',
          kind: (template?.homeKind ?? 'apartment') as 'apartment',
        })
        .select()
        .single();

      if (template && home) {
        // Комнаты создаём одним запросом, чтобы онбординг не тормозил
        const { data: spaces } = await supabase
          .from('spaces')
          .insert(
            template.rooms.map((room, index) => ({
              household_id: householdId,
              home_id: home.id,
              name: room.name,
              kind: room.kind as 'kitchen',
              icon: room.icon,
              sort_order: index * 10,
            }))
          )
          .select();

        if (spaces) {
          const byName = new Map(spaces.map((space) => [space.name, space.id]));
          const items = template.rooms.flatMap((room) =>
            room.items.map((item, index) => ({
              household_id: householdId,
              home_id: home.id,
              space_id: byName.get(room.name) ?? null,
              name: item.name,
              category_id: item.category_id,
              sort_order: index * 10,
            }))
          );
          if (items.length > 0) await supabase.from('items').insert(items);
        }
      }

      await queryClient.invalidateQueries();
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-10">
      {step === 'welcome' && (
        <>
          <div className="text-center">
            <p className="text-6xl" aria-hidden="true">🏠</p>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-ink text-balance">
              {t('onboarding.welcomeTitle')}
            </h1>
            <p className="mt-3 text-ink-2">{t('onboarding.welcomeText')}</p>
          </div>
          <Button size="lg" block onClick={() => setStep('name')}>
            {t('onboarding.start')}
          </Button>
        </>
      )}

      {step === 'name' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setStep('template');
          }}
          className="flex flex-col gap-6"
        >
          <h1 className="text-2xl font-extrabold tracking-tight text-ink text-balance">
            {t('onboarding.homeNameTitle')}
          </h1>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('onboarding.homeNamePlaceholder')}
            hint={t('onboarding.homeNameHint')}
          />
          <Button type="submit" size="lg" block>
            {t('common.done')}
          </Button>
        </form>
      )}

      {step === 'template' && (
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink text-balance">
              {t('onboarding.templateTitle')}
            </h1>
            <p className="mt-2 text-ink-2">{t('onboarding.templateHint')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                disabled={busy}
                onClick={() => void build(template)}
                className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-card border border-line bg-surface p-4 text-center active:bg-surface-2 disabled:opacity-60"
              >
                <span className="text-3xl" aria-hidden="true">{template.icon}</span>
                <span className="font-semibold text-ink">{template.name}</span>
                <span className="text-xs text-ink-3">
                  {template.rooms.length} комнат
                </span>
              </button>
            ))}

            <button
              type="button"
              disabled={busy}
              onClick={() => void build(null)}
              className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-2 p-4 text-center active:bg-surface-2 disabled:opacity-60"
            >
              <span className="text-3xl" aria-hidden="true">✏️</span>
              <span className="font-semibold text-ink-2">{t('onboarding.templateSkip')}</span>
            </button>
          </div>

          {busy && <p className="text-center text-ink-3">{t('onboarding.creating')}</p>}
        </div>
      )}

      {step === 'done' && (
        <>
          <div className="text-center">
            <p className="text-6xl" aria-hidden="true">✨</p>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-ink">
              {t('onboarding.readyTitle')}
            </h1>
            <p className="mt-3 text-ink-2">{t('onboarding.readyText')}</p>
          </div>
          <Card className="p-1">
            <Button size="lg" block onClick={onDone}>
              {t('onboarding.addFirst')}
            </Button>
          </Card>
          <Button variant="ghost" block onClick={onDone}>
            {t('onboarding.later')}
          </Button>
        </>
      )}
    </main>
  );
}
