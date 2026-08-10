import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';
import { detectPlatform, isStandalone } from '@/features/pwa/useInstallPrompt';
import { CenteredScreen } from '@/app/CenteredScreen';

/** Через сколько секунд после отправки можно попросить письмо ещё раз. */
const RESEND_COOLDOWN_S = 60;

/** Ниже этой длины Supabase пароль и не примет. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Куда вернуть после перехода по ссылке.
 *
 * window.location.origin один даёт только домен без пути — на GitHub Pages
 * потерялся бы /digital-home/. BASE_URL — тот же basePath, что подставлен
 * сборкой (ADR-017).
 */
const REDIRECT_URL = window.location.origin + import.meta.env.BASE_URL;

type Mode = 'password' | 'link';
type Step = 'form' | 'sent';

/**
 * Вход.
 *
 * Два способа, и порядок между ними не косметический (ADR-010):
 *
 * **Пароль — основной.** Единственный, который работает в установленной PWA
 * на iOS: там веб-приложение с домашнего экрана и Safari имеют полностью
 * изолированные хранилища, а ссылка из письма всегда открывается в Safari.
 * Значит секрет PKCE, сохранённый при запросе внутри PWA, до Safari не
 * доезжает — и вход не срабатывает ни там, ни там. Пароль никуда не выходит
 * из приложения, поэтому работает везде одинаково.
 *
 * **Ссылка на почту — второй.** Удобнее на компьютере и на Android: ничего
 * не надо помнить. На iOS в установленном приложении честно предупреждаем,
 * что она откроется в Safari и войдёт только там.
 */
export function SignIn() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>('password');
  const [step, setStep] = useState<Step>('form');
  const [isSignUp, setIsSignUp] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // На iOS в установленном приложении ссылка из письма уведёт в Safari и
  // войдёт только там — предупреждаем заранее, а не даём напороться
  const linkGoesToBrowser = detectPlatform() === 'ios' && isStandalone();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function reset() {
    setError(null);
    setNotice(null);
  }

  async function withPassword(event: React.FormEvent) {
    event.preventDefault();
    reset();
    setBusy(true);

    const credentials = { email: email.trim(), password };

    const { error: authError } = isSignUp
      ? await supabase.auth.signUp({
          ...credentials,
          options: { emailRedirectTo: REDIRECT_URL },
        })
      : await supabase.auth.signInWithPassword(credentials);

    setBusy(false);

    if (!authError) {
      // При успехе onAuthStateChange сам перерисует приложение.
      // Исключение — регистрация с включённым подтверждением почты: сессии
      // ещё нет, и человек должен понять, что нужно сделать дальше
      if (isSignUp) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) setNotice(t('auth.confirmEmailNotice'));
      }
      return;
    }

    console.error('Не удалось войти по паролю:', authError);

    if (authError.status === 429) {
      setError(t('auth.errorRateLimit'));
    } else if (isSignUp && /already registered|already exists/i.test(authError.message)) {
      // Частый случай: человек «регистрируется» повторно. Не ругаемся,
      // а переключаем на вход — он там и хотел оказаться
      setIsSignUp(false);
      setError(t('auth.errorAlreadyRegistered'));
    } else if (!isSignUp && /invalid login credentials/i.test(authError.message)) {
      setError(t('auth.errorWrongPassword'));
    } else if (/password/i.test(authError.message)) {
      setError(t('auth.errorWeakPassword'));
    } else {
      setError(t('auth.errorGeneric'));
    }
  }

  async function requestLink() {
    reset();
    setBusy(true);

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: REDIRECT_URL },
    });

    setBusy(false);
    if (sendError) {
      // Раньше здесь всегда показывалось «проверь адрес», даже когда дело
      // не в адресе — например, в исчерпанном лимите писем
      console.error('Не удалось отправить ссылку для входа:', sendError);
      const rateLimited =
        sendError.status === 429 || /rate limit|too many|after \d+ seconds/i.test(sendError.message);
      setError(rateLimited ? t('auth.errorRateLimit') : t('auth.errorEmail'));
      return;
    }
    setStep('sent');
    setCooldown(RESEND_COOLDOWN_S);
  }

  async function withProvider(provider: 'google' | 'apple') {
    reset();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: REDIRECT_URL },
    });
    if (oauthError) setError(t('auth.errorGeneric'));
  }

  const emailValid = email.includes('@');

  return (
    <CenteredScreen className="gap-8 py-10">
      <header className="text-center">
        <p className="text-5xl" aria-hidden="true">🏠</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">{t('app.name')}</h1>
        <p className="mt-1 text-ink-2">{t('app.tagline')}</p>
      </header>

      {step === 'sent' ? (
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
            onClick={() => void requestLink()}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
          </Button>

          <Button variant="ghost" block onClick={() => { setStep('form'); reset(); }}>
            {t('common.back')}
          </Button>
        </div>
      ) : (
        <>
          <form onSubmit={withPassword} className="flex flex-col gap-4">
            <Input
              label={t('auth.email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(event) => { setEmail(event.target.value); reset(); }}
            />

            {mode === 'password' && (
              <Input
                label={t('auth.password')}
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                // Подсказка браузеру и менеджеру паролей: новый пароль при
                // регистрации, существующий при входе
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => { setPassword(event.target.value); reset(); }}
                hint={isSignUp ? t('auth.passwordHint') : undefined}
              />
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
            {notice && (
              <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-ink">{notice}</p>
            )}

            {mode === 'password' ? (
              <>
                <Button
                  type="submit"
                  size="lg"
                  block
                  loading={busy}
                  disabled={!emailValid || password.length < MIN_PASSWORD_LENGTH}
                >
                  {isSignUp ? t('auth.signUp') : t('auth.signIn')}
                </Button>

                <button
                  type="button"
                  onClick={() => { setIsSignUp((value) => !value); reset(); }}
                  className="min-h-10 text-sm font-semibold text-accent-ink"
                >
                  {isSignUp ? t('auth.haveAccount') : t('auth.noAccount')}
                </button>
              </>
            ) : (
              <Button
                type="button"
                size="lg"
                block
                loading={busy}
                disabled={!emailValid}
                onClick={() => void requestLink()}
              >
                {t('auth.sendLink')}
              </Button>
            )}
          </form>

          <div className="flex items-center gap-3 text-sm text-ink-3">
            <span className="h-px flex-1 bg-line" />
            {t('auth.or')}
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="flex flex-col gap-3">
            {mode === 'password' ? (
              <>
                <Button variant="secondary" block onClick={() => { setMode('link'); reset(); }}>
                  {t('auth.useLink')}
                </Button>
                {linkGoesToBrowser && (
                  <p className="text-center text-xs text-ink-3">{t('auth.linkIosWarning')}</p>
                )}
              </>
            ) : (
              <Button variant="secondary" block onClick={() => { setMode('password'); reset(); }}>
                {t('auth.usePassword')}
              </Button>
            )}

            <Button variant="secondary" block onClick={() => void withProvider('google')}>
              {t('auth.google')}
            </Button>
            <Button variant="secondary" block onClick={() => void withProvider('apple')}>
              {t('auth.apple')}
            </Button>
          </div>
        </>
      )}
    </CenteredScreen>
  );
}
