import { useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { usePostponeToday } from '@/entities/plan'
import { useSession, useUser } from '@/entities/session'
import { useIsNotMyDay, useSettings } from '@/entities/settings'
import { cn } from '@/shared/lib/cn'
import { useT } from '@/shared/lib/i18n'
import { useResolvedTheme } from '@/shared/lib/theme'
import { Avatar, BrandMark, Button, Dialog, Icon, Note, Row, toast } from '@/shared/ui'
import { navFor, SECONDARY_NAV, type NavItem } from './nav'
import s from './AppShell.module.css'

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

/** «Не мой день» (идея 44): одна кнопка, причину никто не спрашивает. */
function NotMyDayDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const isOn = useIsNotMyDay()
  const setNotMyDay = useSettings((state) => state.setNotMyDay)
  const postpone = usePostponeToday()

  const enable = () => {
    setNotMyDay(true)
    postpone.mutate(undefined, {
      onError: () => toast.error(t('Не получилось перенести шаги', 'Could not move the steps')),
    })
  }

  const askDayOff = () => {
    onClose()
    void navigate({
      to: '/chats',
      search: { c: 'buddy', q: t('Оформи отгул на сегодня', 'Request a day off for today') },
    })
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        isOn ? t('Сегодня не твой день', 'Not your day today') : t('Не мой день', 'Not my day')
      }
      footer={
        isOn ? (
          <>
            <Button variant="primary" onClick={askDayOff}>
              {t('Подготовить отгул', 'Draft a day off')}
            </Button>
            <Button
              onClick={() => {
                setNotMyDay(false)
                onClose()
              }}
            >
              {t('Вернуть как было', 'Turn it off')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={enable} isLoading={postpone.isPending}>
              {t('Включить до конца дня', 'Turn on until tomorrow')}
            </Button>
            <Button onClick={onClose}>{t('Отмена', 'Cancel')}</Button>
          </>
        )
      }
    >
      {isOn ? (
        <p>
          {t(
            'Понял. Сегодня без напоминаний, личные шаги перенёс на завтра. Если нужен отгул, подготовлю заявку - отправишь сам',
            'Got it. No reminders today, personal steps moved to tomorrow. If you need a day off, I will draft the request - you send it yourself',
          )}
        </p>
      ) : (
        <p>
          {t(
            'Сниму напоминания на сегодня и перенесу личные шаги на завтра. Причину объяснять не нужно',
            'I will mute reminders for today and move personal steps to tomorrow. No need to explain why',
          )}
        </p>
      )}
      <Note tone="private" title={t('Видишь только ты', 'Only you can see this')}>
        {t(
          'Наставник и руководитель об этом не узнают. Обязательные дедлайны не двигаются',
          'Your mentor and lead will not know. Hard deadlines stay where they are',
        )}
      </Note>
    </Dialog>
  )
}

/** Меню профиля. На телефоне здесь же пункты, которые не влезли в нижнюю панель. */
function ProfileDialog({
  isOpen,
  onClose,
  extraNav,
}: {
  isOpen: boolean
  onClose: () => void
  extraNav: NavItem[]
}) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const user = useUser()
  const navigate = useNavigate()
  const signOut = useSession((state) => state.signOut)
  const theme = useResolvedTheme()
  const setTheme = useSettings((state) => state.setTheme)

  const go = (to: string) => {
    onClose()
    void navigate({ to })
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={user.employee.name} width={400}>
      <div className={s.menu}>
        {extraNav.map((item) => (
          <Row
            key={item.to}
            className={s.onlyMobile}
            leading={<Icon name={item.icon} />}
            title={item.label[lang]}
            trailing={<Icon name="chevronRight" size={18} />}
            onClick={() => go(item.to)}
          />
        ))}
        {SECONDARY_NAV.map((item) => (
          <Row
            key={item.to}
            leading={<Icon name={item.icon} />}
            title={item.label[lang]}
            trailing={<Icon name="chevronRight" size={18} />}
            onClick={() => go(item.to)}
          />
        ))}
        {user.role === 'intern' && (
          <Row
            leading={<Icon name="history" />}
            title={t('История действий', 'Action history')}
            subtitle={t('Заявки, брони, вопросы наставнику', 'Requests, bookings, questions')}
            trailing={<Icon name="chevronRight" size={18} />}
            onClick={() => go('/actions')}
          />
        )}
        <Row
          leading={<Icon name="settings" />}
          title={t('Настройки', 'Settings')}
          subtitle={t('Границы, уведомления, язык', 'Boundaries, notifications, language')}
          trailing={<Icon name="chevronRight" size={18} />}
          onClick={() => go('/settings')}
        />
        <Row
          leading={<Icon name={theme === 'dark' ? 'sun' : 'moon'} />}
          title={
            theme === 'dark' ? t('Светлая тема', 'Light theme') : t('Тёмная тема', 'Dark theme')
          }
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <Row
          leading={<Icon name="logout" />}
          title={t('Сменить пользователя', 'Switch user')}
          subtitle={user.login}
          onClick={() => {
            onClose()
            signOut()
            void navigate({ to: '/login' })
          }}
        />
      </div>
    </Dialog>
  )
}

export function AppShell() {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const user = useUser()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isNotMyDay = useIsNotMyDay()
  const [isDayOpen, setDayOpen] = useState(false)
  const [isProfileOpen, setProfileOpen] = useState(false)

  const nav = navFor(user.role)
  const primary = nav.filter((item) => item.isPrimary)
  const extra = nav.filter((item) => !item.isPrimary)
  const isExtraActive =
    [...extra, ...SECONDARY_NAV].some((item) => isActive(pathname, item.to)) ||
    pathname === '/settings'

  return (
    <div className={s.shell}>
      <a href="#main" className={cn('visually-hidden', s.skip)}>
        {t('К содержимому', 'Skip to content')}
      </a>

      <header className={s.header}>
        <Link to={nav[0].to} className={s.logo} aria-label="AI-buddy">
          <BrandMark size={30} />
          <span>buddy</span>
        </Link>

        <nav className={s.tabs} aria-label={t('Разделы', 'Sections')}>
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={s.tab}
              aria-current={isActive(pathname, item.to) ? 'page' : undefined}
            >
              {item.label[lang]}
            </Link>
          ))}
        </nav>

        <div className={s.actions}>
          {user.role === 'intern' && (
            <button
              type="button"
              className={cn(s.dayButton, isNotMyDay && s.dayOn)}
              onClick={() => setDayOpen(true)}
              aria-pressed={isNotMyDay}
            >
              <Icon name="dayOff" size={20} />
              <span>
                {isNotMyDay ? t('Тихий день', 'Quiet day') : t('Не мой день', 'Not my day')}
              </span>
            </button>
          )}
          <button
            type="button"
            className={s.me}
            onClick={() => setProfileOpen(true)}
            aria-label={t('Меню профиля', 'Profile menu')}
          >
            <span className={s.meName}>{user.employee.short}</span>
            <Avatar name={user.employee.name} color={user.employee.color} size={40} />
          </button>
        </div>
      </header>

      <main id="main" className={s.main} tabIndex={-1}>
        <Outlet />
      </main>

      <nav className={s.tabbar} aria-label={t('Разделы', 'Sections')}>
        {primary.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={s.tabbarItem}
            aria-current={isActive(pathname, item.to) ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label[lang]}</span>
          </Link>
        ))}
        <button
          type="button"
          className={s.tabbarItem}
          aria-current={isExtraActive ? 'page' : undefined}
          onClick={() => setProfileOpen(true)}
        >
          <Icon name="grid" />
          <span>{t('Ещё', 'More')}</span>
        </button>
      </nav>

      <NotMyDayDialog isOpen={isDayOpen} onClose={() => setDayOpen(false)} />
      <ProfileDialog
        isOpen={isProfileOpen}
        onClose={() => setProfileOpen(false)}
        extraNav={extra}
      />
    </div>
  )
}
