import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/auth/useSession';
import { SignIn } from '@/features/auth/SignIn';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { useActiveHousehold } from '@/features/household/useHousehold';
import { HomeScreen } from '@/features/home/HomeScreen';
import { RoomScreen } from '@/features/home/RoomScreen';
import { ItemScreen } from '@/features/items/ItemScreen';
import { AddItemSheet } from '@/features/items/AddItemSheet';
import { SearchScreen } from '@/features/search/SearchScreen';
import { HouseholdScreen } from '@/features/household/HouseholdScreen';
import { JoinScreen } from '@/features/household/JoinScreen';
import { MoreScreen } from '@/features/more/MoreScreen';
import { TasksScreen } from '@/features/tasks/TasksScreen';
import { InstallCoach } from '@/features/pwa/InstallCoach';
import { OfflineBanner, UpdateToast } from '@/features/pwa/StatusBanners';
import { startSync } from '@/lib/outbox';
import { TabBar } from './TabBar';
import { EmptyState, Spinner } from '@/components/ui';

export function App() {
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const household = useActiveHousehold();
  const location = useLocation();
  const [adding, setAdding] = useState(false);

  // Очередь отправки поднимается после входа: до него отправлять нечего и
  // некуда
  useEffect(() => {
    if (session) startSync();
  }, [session]);

  if (loading) return <Spinner label={t('common.loading')} />;

  // Ссылка-приглашение может прийти человеку, которого в приложении ещё нет:
  // сначала вход, а адрес /join/КОД сохранится и сработает следующим шагом
  if (!session) return <SignIn />;

  if (household.isLoading) return <Spinner label={t('common.loading')} />;

  // Пришли по ссылке-приглашению — принимаем её раньше онбординга,
  // иначе человек создаст пустой второй дом вместо того, чтобы войти в общий
  if (location.pathname.startsWith('/join')) {
    return (
      <Routes>
        <Route path="/join" element={<JoinScreen />} />
        <Route path="/join/:code" element={<JoinScreen />} />
      </Routes>
    );
  }

  if (!household.householdId) {
    return <Onboarding onDone={() => setAdding(true)} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <OfflineBanner />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/room/:spaceId" element={<RoomScreen />} />
          <Route path="/item/:itemId" element={<ItemScreen />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/household" element={<HouseholdScreen />} />
          <Route path="/join" element={<JoinScreen />} />
          <Route path="/more" element={<MoreScreen />} />

          <Route path="/tasks" element={<TasksScreen />} />
          <Route path="/energy" element={<ComingSoon icon="⚡" title={t('tabs.energy')} />} />

          <Route path="/404" element={<NotFound />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </main>

      <TabBar onAdd={() => setAdding(true)} canWrite={household.canWrite} />

      <AddItemSheet open={adding} onClose={() => setAdding(false)} />
      <InstallCoach ready={Boolean(household.householdId)} />
      <UpdateToast />
    </div>
  );
}

/** Вкладки следующих фаз: честная заглушка вместо пустого экрана. */
function ComingSoon({ icon, title }: { icon: string; title: string }) {
  const { t } = useTranslation();
  return <EmptyState icon={icon} title={title} text={t('more.phaseNote')} />;
}

function NotFound() {
  const { t } = useTranslation();
  return <EmptyState icon="🤷" title={t('errors.notFound')} text={t('errors.notFoundHint')} />;
}
