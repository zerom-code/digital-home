import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/useSession';
import {
  useActiveHousehold,
  useCreateInvite,
  useInvites,
  useMembers,
  useRevokeInvite,
} from './useHousehold';
import { formatInviteCode, inviteUrl } from '@/lib/invite';
import { Button, Card, Chip, Spinner, useToast } from '@/components/ui';
import { PageHeader } from '@/app/PageHeader';
import type { Role } from '@/lib/supabase/types';

const ROLE_LABEL: Record<Role, string> = {
  owner: 'household.roleOwner',
  admin: 'household.roleAdmin',
  member: 'household.roleMember',
  guest: 'household.roleGuest',
};

export function HouseholdScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useSession();
  const { householdId, household, isAdmin } = useActiveHousehold();

  const members = useMembers(householdId);
  const invites = useInvites(householdId);
  const createInvite = useCreateInvite(householdId);
  const revokeInvite = useRevokeInvite(householdId);

  const active = invites.data?.[0] ?? null;
  const appUrl = import.meta.env.VITE_APP_URL ?? window.location.origin;

  async function share(code: string) {
    const url = inviteUrl(code, appUrl);
    const text = `Заходи в наш дом в «Домовом»: ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: t('household.inviteTitle'), text, url });
        return;
      } catch {
        // Человек закрыл системное окно — это не ошибка
        return;
      }
    }

    await navigator.clipboard.writeText(url);
    toast.show(t('common.copied'));
  }

  return (
    <div className="flex flex-col">
      <PageHeader title={household?.name ?? t('household.title')} icon="👨‍👩‍👧" />

      <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            {t('household.members')}
          </h2>

          {members.isLoading ? (
            <Spinner />
          ) : (
            <Card className="divide-y divide-line">
              {(members.data ?? []).map((member) => (
                <div key={member.user_id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink"
                  >
                    {(member.profiles?.display_name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 text-ink">
                    {member.profiles?.display_name ?? 'Без имени'}
                    {member.user_id === session?.user.id && (
                      <span className="text-ink-3"> · {t('household.you')}</span>
                    )}
                  </span>
                  <Chip tone={member.role === 'guest' ? 'neutral' : 'accent'}>
                    {t(ROLE_LABEL[member.role])}
                  </Chip>
                </div>
              ))}
            </Card>
          )}
        </section>

        {isAdmin && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              {t('household.invite')}
            </h2>

            {active ? (
              <Card className="flex flex-col gap-3 p-4">
                <p className="text-sm text-ink-2">{t('household.inviteText')}</p>

                <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-ink-3">
                    {t('household.inviteCode')}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-ink">
                    {formatInviteCode(active.code)}
                  </p>
                </div>

                <Button block onClick={() => void share(active.code)}>
                  {t('common.share')}
                </Button>
                <Button
                  variant="ghost"
                  block
                  onClick={async () => {
                    await revokeInvite.mutateAsync(active.id);
                    toast.show(t('household.inviteRevoked'));
                  }}
                >
                  {t('household.inviteRevoke')}
                </Button>
              </Card>
            ) : (
              <Button
                block
                loading={createInvite.isPending}
                onClick={() => void createInvite.mutate('member')}
              >
                {t('household.inviteCreate')}
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
