import type { Role } from '@/entities/session'
import type { IconName } from '@/shared/ui'

export interface NavItem {
  to: string
  icon: IconName
  label: { ru: string; en: string }
  /** Показывать в нижней панели на телефоне (остальное уходит в «Ещё») */
  isPrimary: boolean
}

const INTERN_NAV: NavItem[] = [
  { to: '/', icon: 'home', label: { ru: 'Главная', en: 'Home' }, isPrimary: true },
  {
    to: '/onboarding',
    icon: 'plan',
    label: { ru: 'Онбординг', en: 'Onboarding' },
    isPrimary: true,
  },
  { to: '/chats', icon: 'chat', label: { ru: 'Чаты', en: 'Chats' }, isPrimary: true },
  { to: '/people', icon: 'people', label: { ru: 'Люди', en: 'People' }, isPrimary: false },
  { to: '/map', icon: 'map', label: { ru: 'Карта', en: 'Map' }, isPrimary: false },
  { to: '/events', icon: 'events', label: { ru: 'События', en: 'Events' }, isPrimary: true },
  { to: '/growth', icon: 'growth', label: { ru: 'Рост', en: 'Growth' }, isPrimary: false },
]

const MENTOR_NAV: NavItem[] = [
  { to: '/mentor', icon: 'people', label: { ru: 'Стажёры', en: 'Interns' }, isPrimary: true },
  { to: '/chats', icon: 'chat', label: { ru: 'Чаты', en: 'Chats' }, isPrimary: true },
  { to: '/map', icon: 'map', label: { ru: 'Карта', en: 'Map' }, isPrimary: true },
  { to: '/events', icon: 'events', label: { ru: 'События', en: 'Events' }, isPrimary: true },
]

const LEAD_NAV: NavItem[] = [
  { to: '/mentor', icon: 'people', label: { ru: 'Команда', en: 'Team' }, isPrimary: true },
  { to: '/analytics', icon: 'chart', label: { ru: 'Аналитика', en: 'Analytics' }, isPrimary: true },
  { to: '/chats', icon: 'chat', label: { ru: 'Чаты', en: 'Chats' }, isPrimary: true },
  { to: '/events', icon: 'events', label: { ru: 'События', en: 'Events' }, isPrimary: true },
]

const HR_NAV: NavItem[] = [
  { to: '/analytics', icon: 'chart', label: { ru: 'Аналитика', en: 'Analytics' }, isPrimary: true },
  { to: '/chats', icon: 'chat', label: { ru: 'Чаты', en: 'Chats' }, isPrimary: true },
  { to: '/events', icon: 'events', label: { ru: 'События', en: 'Events' }, isPrimary: true },
]

const NAV: Record<Role, NavItem[]> = {
  intern: INTERN_NAV,
  buddy: MENTOR_NAV,
  lead: LEAD_NAV,
  hr: HR_NAV,
}

export function navFor(role: Role): NavItem[] {
  return NAV[role]
}

/** Стартовый экран роли. */
export function homeFor(role: Role): string {
  return NAV[role][0].to
}

/** Пути, закрытые для роли: роутер уводит на стартовый экран (второй уровень защиты, первый - API). */
const INTERN_ONLY = ['/', '/onboarding', '/people', '/growth', '/actions', '/first-day']
const STAFF_ONLY: Record<string, Role[]> = {
  '/mentor': ['buddy', 'lead'],
  '/analytics': ['lead', 'hr'],
}

export function canOpen(role: Role, path: string): boolean {
  const staffRule = Object.entries(STAFF_ONLY).find(
    ([prefix]) => path === prefix || path.startsWith(prefix + '/'),
  )
  if (staffRule) return staffRule[1].includes(role)
  if (INTERN_ONLY.includes(path)) return role === 'intern'
  return true
}
