import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useInstallPrompt } from './useInstallPrompt';
import { Button, Sheet } from '@/components/ui';

const DISMISSED_KEY = 'domovoy.installDismissed';

/**
 * Подсказка про установку.
 *
 * Показывается не сразу при первом заходе, а когда в доме уже что-то есть:
 * предлагать «поставить приложение» человеку, который ещё не понял, зачем
 * оно, — верный способ получить отказ.
 */
export function InstallCoach({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const install = useInstallPrompt();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1'
  );

  const shouldShow =
    ready && !dismissed && !install.installed && (install.canPrompt || install.needsManualInstructions);

  function close() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <Sheet open={shouldShow} onClose={close} title={t('pwa.installTitle')}>
      <div className="flex flex-col gap-5">
        <p className="text-ink-2">{t('pwa.installText')}</p>

        {install.canPrompt ? (
          <Button
            size="lg"
            block
            onClick={async () => {
              await install.prompt();
              close();
            }}
          >
            {t('pwa.installAndroid')}
          </Button>
        ) : (
          <>
            <ol className="flex flex-col gap-3">
              {[t('pwa.iosStep1'), t('pwa.iosStep2'), t('pwa.iosStep3')].map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink">
                    {index + 1}
                  </span>
                  <span className="text-ink">{step}</span>
                </li>
              ))}
            </ol>
            <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
              {t('pwa.iosNote')}
            </p>
          </>
        )}

        <Button variant="ghost" block onClick={close}>
          {t('onboarding.later')}
        </Button>
      </div>
    </Sheet>
  );
}
