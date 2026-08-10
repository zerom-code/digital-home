import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';

type Step = 'email' | 'sent';

/** Через сколько секунд после отправки можно попросить письмо ещё раз. */
const RESEND_COOLDOWN_S = 60;

/**
 * Вход по ссылке на почту.
 *
 * Пароля нет сознательно (ADR-010): для нетехнического человека пароль —
 * самая частая точка отказа.
 *
 * Ссылка, а не шестизначный код: бесплатный план Supabase не даёт
 * редактировать текст письма без своего SMTP-сервера, а стандартное письмо
 * Supabase содержит именно кнопку-ссылку. Подстраиваемся под то, что
 * работает без дополнительной настройки, а не требуем её на самом старте.
 * detectSessionInUrl в lib/supabase/client.ts уже подхватывает токен из
 * адресной строки после перехода по ссылке — здесь дополнительный код не
 * нужен, ровно так же устроен вход через Google и Apple ниже.
 */
export function SignIn() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestLink(targetEmail: string) {
    setError(null);
    setBusy(true);

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    });

    setBusy(false);
    if (sendError) {
      setError(t('auth.errorEmail'));
      return;
    }
    setStep('sent');
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function withProvider(provider: 'google' | 'apple') {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) setError(t('auth.errorGeneric'));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-10">
      <header className="text-center">
        <p className="text-5xl" aria-hidden="true">🏠</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">
          {t('app.name')}
        </h1>
        <p className="mt-1 text-ink-2">{t('app.tagline')}</p>
      </header>

      {step === 'email' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void requestLink(email.trim());
          }}
          className="flex flex-col gap-4"
        >
          <Input
            label={t('auth.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            required
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error ?? undefined}
            hint={t('auth.subtitle')}
          />
          <Button type="submit" size="lg" block loading={busy} disabled={!email.includes('@')}>
            {t('auth.sendLink')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-accent-soft px-4 py-5 text-center">
            <p className="text-3xl" aria-hidden="true">✉️</p>
            <p className="mt-2 font-semibold text-ink">{t('auth.sentTitle')}</p>
            <p className="mt-1 text-sm text-ink-2">{t('auth.sentText', { email })}</p>
          </div>
          <p className="text-center text-sm text-ink-3">{t('auth.sentHint')}</p>

          {error && <p className="text-center text-sm text-danger">{error}</p>}

          <Button
            variant="secondary"
            block
            loading={busy}
            disabled={cooldown > 0}
            onClick={() => void requestLink(email.trim())}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          </Button>

          <Button
            variant="ghost"
            block
            onClick={() => {
              setStep('email');
              setError(null);
            }}
          >
            {t('auth.changeEmail')}
          </Button>
        </div>
      )}

      {step === 'email' && (
        <>
          <div className="flex items-center gap-3 text-sm text-ink-3">
            <span className="h-px flex-1 bg-line" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex flex-col gap-3">
            <Button variant="secondary" size="lg" block onClick={() => void withProvider('google')}>
              {t('auth.google')}
            </Button>
            <Button variant="secondary" size="lg" block onClick={() => void withProvider('apple')}>
              {t('auth.apple')}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
