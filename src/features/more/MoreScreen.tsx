import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';
import { signOut, useSession } from '@/features/auth/useSession';
import { useActiveHousehold } from '@/features/household/useHousehold';
import { useInstallPrompt } from '@/features/pwa/useInstallPrompt';
import { usePush } from '@/features/pwa/usePush';
import { clearOutbox } from '@/lib/outbox';
import { Button, Card, Row, Sheet, useToast } from '@/components/ui';

const VERSION = '0.2.0';

export function MoreScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useSession();
  const { household, householdId, isAdmin } = useActiveHousehold();
  const install = useInstallPrompt();
  const push = usePush();
  const ai = useAiSettings(householdId);

  const [large, setLarge] = useState(
    () => document.documentElement.dataset['textSize'] === 'large'
  );
  const [askingAi, setAskingAi] = useState(false);

  function toggleTextSize() {
    const next = !large;
    if (next) document.documentElement.dataset['textSize'] = 'large';
    else delete document.documentElement.dataset['textSize'];
    localStorage.setItem('domovoy.textSize', next ? 'large' : 'normal');
    setLarge(next);
  }

  async function togglePush() {
    if (push.state === 'on') {
      await push.disable();
      return;
    }
    const ok = await push.enable();
    if (!ok && push.state === 'denied') toast.show(t('push.deniedHint'), { tone: 'danger' });
  }

  const pushValue = {
    on: t('push.on'),
    off: t('push.off'),
    denied: t('push.denied'),
    'needs-install': t('push.needsInstall'),
    unsupported: t('push.unsupported'),
  }[push.state];

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('more.title')}</h1>

      <Card>
        <Row icon="👨‍👩‍👧" title={t('more.household')} to="/household" value={household?.name ?? undefined} />
        <Row icon="🔑" title={t('household.joinTitle')} to="/join" />
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-ink-3">
          {t('push.title')}
        </h2>
        <Card>
          <Row
            icon="🔔"
            title={t('push.title')}
            value={pushValue}
            onClick={
              push.state === 'on' || push.state === 'off' ? () => void togglePush() : undefined
            }
          />
        </Card>
        <p className="px-1 text-sm text-ink-3">
          {push.state === 'needs-install' ? t('push.needsInstallHint') : t('push.hint')}
        </p>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-ink-3">
            {t('ai.settingsTitle')}
          </h2>
          <Card>
            <Row
              icon="✨"
              title={t('ai.settingsTitle')}
              value={ai.data?.enabled ? t('push.on') : t('push.off')}
              onClick={() => {
                if (ai.data?.enabled) void ai.setEnabled.mutate(false);
                else setAskingAi(true);
              }}
            />
          </Card>
          <p className="px-1 text-sm text-ink-3">{t('ai.settingsHint')}</p>
        </section>
      )}

      <Card>
        <Row icon="🔤" title="Крупный текст" onClick={toggleTextSize} value={large ? 'вкл' : 'выкл'} />
        {install.canPrompt && (
          <Row icon="📲" title={t('more.install')} onClick={() => void install.prompt()} />
        )}
      </Card>

      <Card>
        <Row icon="✉️" title={session?.user.email ?? ''} />
        <Row
          icon="🚪"
          title={t('auth.signOut')}
          danger
          onClick={async () => {
            await clearOutbox();
            await signOut();
          }}
        />
      </Card>

      <p className="px-2 text-center text-sm text-ink-3">
        {t('more.phaseNote')}
        <br />
        {t('more.version', { version: VERSION })}
      </p>

      {/* Согласие спрашиваем явно и один раз: снимки уходят наружу */}
      <Sheet open={askingAi} onClose={() => setAskingAi(false)} title={t('ai.consentTitle')}>
        <div className="flex flex-col gap-5">
          <p className="text-ink-2">{t('ai.consentText')}</p>
          <Button
            size="lg"
            block
            onClick={() => {
              ai.setEnabled.mutate(true);
              setAskingAi(false);
            }}
          >
            {t('ai.consentAccept')}
          </Button>
          <Button variant="ghost" block onClick={() => setAskingAi(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function useAiSettings(householdId: string | null) {
  const queryClient = useQueryClient();
  const key = ['ai_settings', householdId ?? 'none'];

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(householdId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_settings')
        .select('*')
        .eq('household_id', householdId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const setEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('ai_settings')
        .update({
          enabled,
          consent_at: enabled ? new Date().toISOString() : null,
          consent_by: enabled ? auth.user?.id ?? null : null,
        })
        .eq('household_id', householdId!);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return { ...query, setEnabled };
}
