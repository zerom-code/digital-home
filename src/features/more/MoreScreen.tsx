import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { signOut, useSession } from '@/features/auth/useSession';
import { useActiveHousehold } from '@/features/household/useHousehold';
import { useInstallPrompt } from '@/features/pwa/useInstallPrompt';
import { Card, Row } from '@/components/ui';

const VERSION = '0.1.0';

export function MoreScreen() {
  const { t } = useTranslation();
  const { session } = useSession();
  const { household } = useActiveHousehold();
  const install = useInstallPrompt();

  const [large, setLarge] = useState(
    () => document.documentElement.dataset['textSize'] === 'large'
  );

  function toggleTextSize() {
    const next = !large;
    if (next) document.documentElement.dataset['textSize'] = 'large';
    else delete document.documentElement.dataset['textSize'];
    localStorage.setItem('domovoy.textSize', next ? 'large' : 'normal');
    setLarge(next);
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">{t('more.title')}</h1>

      <Card>
        <Row icon="👨‍👩‍👧" title={t('more.household')} to="/household" value={household?.name ?? undefined} />
        <Row icon="🔑" title={t('household.joinTitle')} to="/join" />
      </Card>

      <Card>
        <Row icon="🔤" title="Крупный текст" onClick={toggleTextSize} value={large ? 'вкл' : 'выкл'} />
        {install.canPrompt && (
          <Row icon="📲" title={t('more.install')} onClick={() => void install.prompt()} />
        )}
      </Card>

      <Card>
        <Row icon="✉️" title={session?.user.email ?? ''} />
        <Row icon="🚪" title={t('auth.signOut')} danger onClick={() => void signOut()} />
      </Card>

      <p className="px-2 text-center text-sm text-ink-3">
        {t('more.phaseNote')}
        <br />
        {t('more.version', { version: VERSION })}
      </p>
    </div>
  );
}
