import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Input, Sheet, useToast } from '@/components/ui';
import { useCreatePlugToken, usePlugTokens, useRevokePlugToken } from './usePlugs';

interface Props {
  open: boolean;
  onClose: () => void;
  householdId: string;
}

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plug-ingest`;

/**
 * Подключение розетки.
 *
 * Здесь приходится сказать неприятное вслух: одной розетки мало, нужен ещё
 * компьютер, который всегда включён. Это не наша прихоть — розетка отвечает
 * только по локальной сети и только по http, и страница на https до неё не
 * достучится никогда. Прятать это ограничение за бодрым «подключить за минуту»
 * значит обмануть человека, который потом полчаса будет искать, почему не
 * работает.
 */
export function PlugSetupSheet({ open, onClose, householdId }: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  const tokens = usePlugTokens(householdId);
  const createToken = useCreatePlugToken(householdId);
  const revokeToken = useRevokePlugToken(householdId);

  const [name, setName] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    // Выданный ключ забываем при закрытии: он уже нигде не хранится в открытом
    // виде, и держать его в памяти вкладки дольше нужного незачем
    setIssued(null);
    setName('');
    onClose();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(t('plugs.copied'));
    } catch {
      // Без https или без разрешения буфер недоступен — не беда, текст на экране
      toast.show(t('plugs.copyFailed'), { tone: 'danger' });
    }
  }

  return (
    <Sheet open={open} onClose={close} title={t('plugs.connect')}>
      <div className="flex flex-col gap-5">
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <p className="font-semibold text-ink">{t('plugs.needBridgeTitle')}</p>
          <p className="mt-1">{t('plugs.needBridgeText')}</p>
        </div>

        {issued ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
              <p className="font-semibold">{t('plugs.tokenOnceTitle')}</p>
              <p className="mt-1">{t('plugs.tokenOnceText')}</p>
            </div>

            <code className="block break-all rounded-xl bg-surface-2 px-4 py-3 font-mono text-xs text-ink">
              {issued}
            </code>

            <Button variant="secondary" block onClick={() => void copy(issued)}>
              {t('plugs.copyToken')}
            </Button>

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">{t('plugs.thenRun')}</p>
              <code className="block whitespace-pre-wrap break-all rounded-xl bg-surface-2 px-4 py-3 font-mono text-xs text-ink-2">
                {[
                  'export TAPO_EMAIL=почта@от.tapo',
                  'export TAPO_PASSWORD=пароль',
                  'export TAPO_HOST=192.168.0.50',
                  `export DOMOVOY_INGEST_URL=${INGEST_URL}`,
                  `export DOMOVOY_TOKEN=${issued}`,
                  'python3 tapo_bridge.py --once',
                ].join('\n')}
              </code>
              <p className="mt-2 text-xs text-ink-3">{t('plugs.docsHint')}</p>
            </div>

            <Button block onClick={close}>
              {t('common.done')}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                setIssued(await createToken.mutateAsync(name));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Input
              label={t('plugs.tokenName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint={t('plugs.tokenNameHint')}
              placeholder={t('plugs.tokenNamePlaceholder')}
            />
            <Button type="submit" size="lg" block loading={busy}>
              {t('plugs.createToken')}
            </Button>
          </form>
        )}

        {(tokens.data?.length ?? 0) > 0 && !issued && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              {t('plugs.activeTokens')}
            </h3>
            <ul className="flex flex-col gap-2">
              {tokens.data!.map((token) => (
                <li
                  key={token.id}
                  className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {token.name ?? t('plugs.unnamedToken')}
                    </span>
                    <span className="text-xs text-ink-3">
                      {token.last_used_at
                        ? t('plugs.tokenUsed', {
                            when: new Date(token.last_used_at).toLocaleString('ru-UA'),
                          })
                        : t('plugs.tokenNeverUsed')}
                    </span>
                  </span>
                  {!token.last_used_at && <Chip tone="warn">{t('plugs.tokenIdle')}</Chip>}
                  <button
                    type="button"
                    className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold text-danger"
                    onClick={() => void revokeToken.mutateAsync(token.id)}
                  >
                    {t('plugs.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
