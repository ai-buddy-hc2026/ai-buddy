import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { z } from 'zod'
import { resolveUser, useSession } from '@/entities/session'
import { IS_MOCK, setUnauthorizedHandler, tokenStore } from '@/shared/api/http'
import { useApplyTheme } from '@/shared/lib/theme'
import { ErrorState, Toaster } from '@/shared/ui'
import { AppShell } from './AppShell'
import { canOpen, homeFor } from './nav'

/**
 * Общие search-параметры экранов (состояние вкладок живёт в URL):
 *   tab - активная вкладка внутри раздела
 *   c   - открытый чат в мессенджере (id собеседника или 'buddy')
 *   q   - вопрос, который нужно сразу задать buddy
 *   to  - точка на карте, к которой построить маршрут
 *   id  - выбранная сущность (стажёр, событие)
 */
const searchSchema = z.object({
  tab: z.string().optional(),
  c: z.string().optional(),
  q: z.string().optional(),
  to: z.string().optional(),
  id: z.string().optional(),
})
export type AppSearch = z.infer<typeof searchSchema>

function validateSearch(input: Record<string, unknown>): AppSearch {
  const parsed = searchSchema.safeParse(input)
  return parsed.success ? parsed.data : {}
}

function RootLayout() {
  useApplyTheme()
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <ErrorState text="Такой страницы нет" />,
  errorComponent: ({ error, reset }) => (
    <ErrorState
      text={error instanceof Error ? error.message : 'Что-то сломалось'}
      onRetry={reset}
    />
  ),
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyRouteComponent(() => import('@/features/auth/LoginPage'), 'LoginPage'),
})

/** Всё под оболочкой требует входа и проверки роли. */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: AppShell,
  beforeLoad: ({ location }) => {
    if (!IS_MOCK && !tokenStore.get()) {
      useSession.getState().signOut()
      throw redirect({ to: '/login' })
    }
    const user = resolveUser(useSession.getState().login)
    if (!user) throw redirect({ to: '/login' })
    if (!canOpen(user.role, location.pathname)) throw redirect({ to: homeFor(user.role) })
  },
})

function page<TPath extends string>(
  path: TPath,
  load: () => Promise<Record<string, unknown>>,
  name: string,
) {
  return createRoute({
    getParentRoute: () => shellRoute,
    path,
    validateSearch,
    component: lazyRouteComponent(load, name),
  })
}

const routeTree = rootRoute.addChildren([
  loginRoute,
  shellRoute.addChildren([
    page('/', () => import('@/features/home/HomePage'), 'HomePage'),
    page('/onboarding', () => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage'),
    page('/first-day', () => import('@/features/onboarding/FirstDayPage'), 'FirstDayPage'),
    page('/chats', () => import('@/features/chat/ChatsPage'), 'ChatsPage'),
    page('/actions', () => import('@/features/chat/ActionsPage'), 'ActionsPage'),
    page('/people', () => import('@/features/people/PeoplePage'), 'PeoplePage'),
    page('/map', () => import('@/features/map/MapPage'), 'MapPage'),
    page('/events', () => import('@/features/events/EventsPage'), 'EventsPage'),
    page('/growth', () => import('@/features/growth/GrowthPage'), 'GrowthPage'),
    page('/mentor', () => import('@/features/mentor/MentorPage'), 'MentorPage'),
    page('/analytics', () => import('@/features/analytics/AnalyticsPage'), 'AnalyticsPage'),
    page('/settings', () => import('@/features/settings/SettingsPage'), 'SettingsPage'),
    page('/glossary', () => import('@/features/glossary/GlossaryPage'), 'GlossaryPage'),
    page('/channels', () => import('@/features/channels/ChannelsPage'), 'ChannelsPage'),
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

// 401 с отправленным токеном: сессия истекла, выходим на экран входа
setUnauthorizedHandler(() => {
  useSession.getState().signOut()
  void router.navigate({ to: '/login' })
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
