import { useEffect, useRef, useState } from 'react';
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
import { EnergyScreen } from '@/features/energy/EnergyScreen';
import { InstallCoach } from '@/features/pwa/InstallCoach';
import { OfflineBanner, UpdateToast } from '@/features/pwa/StatusBanners';
import { startSync } from '@/lib/outbox';
import { decideScreen } from '@/lib/household-gate';
import { TabBar } from './TabBar';
import { CenteredScreen } from './CenteredScreen';
import { Button, EmptyState, Spinner } from '@/components/ui';

export function App() {
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const household = useActiveHousehold();
  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const scroller = useRef<HTMLElement>(null);

  // Прокрутка теперь своя у <main>, а не у страницы, и браузер сам её при
  // переходе не сбросит: без этого карточка вещи открывалась бы с середины —
  // ровно с того места, до которого был домотан список
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [location.pathname]);

  // Очередь отправки поднимается после входа: до него отправлять нечего и
  // некуда
  useEffect(() => {
    if (session) startSync();
  }, [session]);

  const isJoining = location.pathname.startsWith('/join');

  // Решение целиком в decideScreen (lib/household-gate.ts) — там же и тесты.
  // Здесь важно только не звать её раньше хуков
  const screen = decideScreen({
    isConfirmed: household.isConfirmed,
    hasHousehold: Boolean(household.householdId),
    isLoading: household.isLoading,
    hasError: Boolean(household.error),
    isJoining,
  });

  // Онбординг «защёлкивается»: показав его, не выходим обратно только потому,
  // что household.householdId появился в кеше. createHousehold делает семью
  // активной сразу после самого первого запроса — а онбордингу ещё нужно
  // успеть создать комнаты и технику из шаблона и показать «Готово!». Без
  // защёлки реактивность useActiveHousehold переключала бы на пустой «Дом»
  // раньше, чем шаблон квартиры успевал построиться.
  useEffect(() => {
    if (screen === 'onboarding' && !onboardingActive) setOnboardingActive(true);
  }, [screen, onboardingActive]);

  if (loading) return <Spinner label={t('common.loading')} />;

  // Ссылка-приглашение может прийти человеку, которого в приложении ещё нет:
  // сначала вход, а адрес /join/КОД сохранится и сработает следующим шагом
  if (!session) return <SignIn />;

  if (screen === 'loading') return <Spinner label={t('common.loading')} />;

  // Сервер не ответил, и показать нечего даже из кеша. Уйти отсюда в
  // онбординг нельзя: дом, скорее всего, есть — просто до него не достучались,
  // и «создать дом» завело бы второй поверх первого
  if (screen === 'error') {
    return (
      <CenteredScreen className="items-center gap-4 py-10 text-center">
        <EmptyState
          icon="📡"
          title={t('errors.loadFailed')}
          text={t('errors.loadFailedHint')}
          action={
            <Button onClick={() => void household.refetch()}>{t('common.retry')}</Button>
          }
        />
      </CenteredScreen>
    );
  }

  // Пришли по ссылке-приглашению — принимаем её раньше онбординга,
  // иначе человек создаст пустой второй дом вместо того, чтобы войти в общий
  if (isJoining) {
    return (
      <Routes>
        <Route path="/join" element={<JoinScreen />} />
        <Route path="/join/:code" element={<JoinScreen />} />
      </Routes>
    );
  }

  if (onboardingActive) {
    return (
      <Onboarding
        onDone={(openAdd) => {
          setOnboardingActive(false);
          if (openAdd) setAdding(true);
        }}
      />
    );
  }

  return (
    // Каркас ровно в высоту окна: он не растягивается содержимым, поэтому
    // нижняя панель всегда на месте (index.css). Всё, что не влезло,
    // прокручивается внутри <main>, а не двигает страницу целиком.
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <OfflineBanner />

      <main ref={scroller} className="app-scroll min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/room/:spaceId" element={<RoomScreen />} />
          <Route path="/item/:itemId" element={<ItemScreen />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/household" element={<HouseholdScreen />} />
          <Route path="/join" element={<JoinScreen />} />
          <Route path="/more" element={<MoreScreen />} />

          <Route path="/tasks" element={<TasksScreen />} />
          <Route path="/energy" element={<EnergyScreen />} />

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

function NotFound() {
  const { t } = useTranslation();
  return <EmptyState icon="🤷" title={t('errors.notFound')} text={t('errors.notFoundHint')} />;
}
