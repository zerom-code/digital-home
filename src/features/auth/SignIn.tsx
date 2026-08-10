import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';

type Step = 'email' | 'code';

/**
 * Вход по коду на почту.
 *
 * Пароля нет сознательно (ADR-010): для нетехнического человека пароль —
 * самая частая точка отказа, а код в письме работает всегда.
 */
export function SignIn() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });

    setBusy(false);
    if (sendError) setError(t('auth.errorEmail'));
    else setStep('code');
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });

    setBusy(false);
    if (verifyError) setError(t('auth.errorCode'));
    // При успехе onAuthStateChange сам перерисует приложение
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
        <form onSubmit={sendCode} className="flex flex-col gap-4">
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
            {t('auth.sendCode')}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <p className="text-center text-ink-2">{t('auth.codeSent', { email })}</p>
          <Input
            label={t('auth.codeLabel')}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            error={error ?? undefined}
            hint={t('auth.codeHint')}
            className="text-center text-2xl tracking-[0.4em]"
          />
          <Button type="submit" size="lg" block loading={busy} disabled={code.length < 6}>
            {t('auth.verify')}
          </Button>
          <Button variant="ghost" block onClick={() => { setStep('email'); setCode(''); setError(null); }}>
            {t('auth.changeEmail')}
          </Button>
        </form>
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
