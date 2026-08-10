import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAcceptInvite } from './useHousehold';
import { parseInviteCode } from '@/lib/invite';
import { Button, Input, Spinner, useToast } from '@/components/ui';

/**
 * Приём приглашения.
 *
 * Работает и по ссылке /join/КОД, и вводом кода руками — второе нужно,
 * когда код продиктовали по телефону.
 */
export function JoinScreen() {
  const { code: codeFromUrl } = useParams<{ code?: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const accept = useAcceptInvite();

  const [code, setCode] = useState(codeFromUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  async function join(raw: string) {
    const parsed = parseInviteCode(raw);
    if (!parsed) {
      setError(t('household.joinError'));
      return;
    }

    setError(null);
    try {
      await accept.mutateAsync(parsed);
      toast.show(t('household.joined'));
      navigate('/', { replace: true });
    } catch {
      setError(t('household.joinError'));
    }
  }

  // Пришли по ссылке — пробуем сразу, без лишнего экрана
  useEffect(() => {
    if (codeFromUrl && !autoTried) {
      setAutoTried(true);
      void join(codeFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl, autoTried]);

  if (codeFromUrl && accept.isPending) {
    return <Spinner label={t('common.loading')} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <p className="text-5xl" aria-hidden="true">🔑</p>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">
          {t('household.joinTitle')}
        </h1>
        <p className="mt-2 text-ink-2">{t('household.joinHint')}</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void join(code);
        }}
      >
        <Input
          autoFocus
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          error={error ?? undefined}
          placeholder="DHKM-7PQR"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="text-center font-mono text-xl tracking-widest"
        />

        <Button type="submit" size="lg" block loading={accept.isPending}>
          {t('household.joinAction')}
        </Button>
        <Button variant="ghost" block onClick={() => navigate('/')}>
          {t('common.cancel')}
        </Button>
      </form>
    </main>
  );
}
