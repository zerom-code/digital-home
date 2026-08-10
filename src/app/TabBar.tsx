import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Props {
  onAdd: () => void;
  canWrite: boolean;
}

const tabs = [
  { to: '/', key: 'tabs.home', icon: '🏠', end: true },
  { to: '/tasks', key: 'tabs.tasks', icon: '✅', end: false },
  { to: '/energy', key: 'tabs.energy', icon: '⚡', end: false },
  { to: '/more', key: 'tabs.more', icon: '👤', end: false },
] as const;

/**
 * Нижняя панель: четыре вкладки и крупная кнопка по центру.
 *
 * Больше четырёх не будет — всё, что открывают раз в месяц, живёт в «Ещё».
 * Вкладки следующих фаз показывают честную заглушку, а не исчезают: так
 * видно, куда движется приложение.
 */
export function TabBar({ onAdd, canWrite }: Props) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('app.name')}
      // Ни sticky, ни fixed: панель — последняя строка нерастяжимого каркаса
      // (index.css), поэтому прижата к низу самой раскладкой. shrink-0 —
      // чтобы длинный список не сплющивал её вместо того, чтобы прокручиваться.
      // relative z-20 нужен из-за круглой кнопки: она торчит над панелью и
      // должна рисоваться поверх содержимого, которое под ней проезжает.
      // Отступ под неё — половина safe-area, не вся: место под жест «домой»
      // остаётся, но иконки не висят высоко над низом экрана, как было при
      // полном отступе (в PWA снизу нет ничего своего, что оправдывало бы
      // такой зазор — это не Safari со строкой поиска).
      className="relative z-20 shrink-0 border-t border-line bg-paper pb-[calc(env(safe-area-inset-bottom)/2)]"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.slice(0, 2).map((tab) => (
          <Tab key={tab.to} to={tab.to} icon={tab.icon} end={tab.end} label={t(tab.key)} />
        ))}

        <li className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={onAdd}
            disabled={!canWrite}
            aria-label={t('tabs.add')}
            className="-mt-5 flex size-14 items-center justify-center rounded-full bg-accent text-2xl text-white shadow-lg active:brightness-110 disabled:opacity-40"
          >
            <span aria-hidden="true">＋</span>
          </button>
        </li>

        {tabs.slice(2).map((tab) => (
          <Tab key={tab.to} to={tab.to} icon={tab.icon} end={tab.end} label={t(tab.key)} />
        ))}
      </ul>
    </nav>
  );
}

function Tab({ to, icon, label, end }: { to: string; icon: string; label: string; end: boolean }) {
  return (
    <li className="flex-1">
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          [
            'flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-xs',
            isActive ? 'text-accent-ink font-semibold' : 'text-ink-3',
          ].join(' ')
        }
      >
        <span aria-hidden="true" className="text-xl">{icon}</span>
        {label}
      </NavLink>
    </li>
  );
}
