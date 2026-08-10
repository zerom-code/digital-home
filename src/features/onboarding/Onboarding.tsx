import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { useCreateHousehold } from '@/features/household/useHousehold';
import { Button, Card, Input, useToast } from '@/components/ui';
import { CenteredScreen } from '@/app/CenteredScreen';
import type { HomeKind, SpaceKind } from '@/lib/supabase/types';
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
interface Props {
  /** true — сразу открыть лист добавления вещи, false — просто на «Дом». */
  onDone: (openAdd: boolean) => void;
}

export function Onboarding({ onDone }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const createHousehold = useCreateHousehold();

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function build(template: Template | null) {
    setBusy(true);
    try {
      const householdId = await createHousehold.mutateAsync(name.trim() || 'Квартира');

      const { data: home, error: homeError } = await supabase
        .from('homes')
        .insert({
          household_id: householdId,
          name: name.trim() || 'Квартира',
          kind: (template?.homeKind ?? 'apartment') as HomeKind,
        })
        .select()
        .single();

      if (homeError) throw homeError;

      if (template && home) {
        // Комнаты создаём одним запросом, чтобы онбординг не тормозил
        const { data: spaces, error: spacesError } = await supabase
          .from('spaces')
          .insert(
            template.rooms.map((room, index) => ({
              household_id: householdId,
              home_id: home.id,
              name: room.name,
              kind: room.kind as SpaceKind,
              icon: room.icon,
              sort_order: index * 10,
            }))
          )
          .select();

        if (spacesError) throw spacesError;

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
          if (items.length > 0) {
            const { error: itemsError } = await supabase.from('items').insert(items);
            if (itemsError) throw itemsError;
          }
        }
      }

      await queryClient.invalidateQueries();
      setStep('done');
    } catch (error) {
      // Семья к этому моменту уже могла создаться — это нормально, важно не
      // молчать про то, что комнаты и технику пришлось бы добавлять руками
      console.error('Не удалось заполнить квартиру по шаблону:', error);
      toast.show(t('onboarding.buildError'), { tone: 'danger' });
      setStep('template');
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredScreen className="gap-8 py-10">
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
            <Button size="lg" block onClick={() => onDone(true)}>
              {t('onboarding.addFirst')}
            </Button>
          </Card>
          <Button variant="ghost" block onClick={() => onDone(false)}>
            {t('onboarding.later')}
          </Button>
        </>
      )}
    </CenteredScreen>
  );
}
