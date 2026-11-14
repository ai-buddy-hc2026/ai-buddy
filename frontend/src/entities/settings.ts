import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_TODAY } from '@/shared/lib/date'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Tone = 'short' | 'detailed'

export interface WorkHours {
  start: string
  end: string
  /** Дни недели, 1 = пн ... 7 = вс */
  days: number[]
}

/** Тумблеры проактивных функций (идеи 15, 20, 22, 23, 24). */
export interface FeatureToggles {
  briefing: boolean
  hints: boolean
  birthdayReminders: boolean
  randomCoffee: boolean
  showInterests: boolean
}

interface SettingsState {
  theme: ThemeChoice
  lang: 'ru' | 'en'
  tone: Tone
  workHours: WorkHours
  toggles: FeatureToggles
  /** Дата, на которую включён режим «Не мой день» (идея 44). null - выключен. */
  notMyDayDate: string | null
  telegramLinked: boolean
  /** Dev-панель: имитация сбоя сервиса «Отсутствия» для демо повтора. */
  simulateFailure: boolean
  /** Dev-панель: «сейчас ночь», чтобы показать отложенную доставку (идея 43). */
  simulateNight: boolean

  setTheme: (theme: ThemeChoice) => void
  setLang: (lang: 'ru' | 'en') => void
  setTone: (tone: Tone) => void
  setWorkHours: (hours: WorkHours) => void
  setToggle: (key: keyof FeatureToggles, value: boolean) => void
  setNotMyDay: (on: boolean) => void
  setTelegramLinked: (linked: boolean) => void
  setSimulateFailure: (on: boolean) => void
  setSimulateNight: (on: boolean) => void
}

export const DEFAULT_WORK_HOURS: WorkHours = { start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5] }

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      lang: 'ru',
      tone: 'short',
      workHours: DEFAULT_WORK_HOURS,
      toggles: {
        briefing: true,
        hints: true,
        birthdayReminders: false,
        randomCoffee: false,
        showInterests: false,
      },
      notMyDayDate: null,
      telegramLinked: false,
      simulateFailure: false,
      simulateNight: false,

      setTheme: (theme) => set({ theme }),
      setLang: (lang) => set({ lang }),
      setTone: (tone) => set({ tone }),
      setWorkHours: (workHours) => set({ workHours }),
      setToggle: (key, value) => set((s) => ({ toggles: { ...s.toggles, [key]: value } })),
      setNotMyDay: (on) => set({ notMyDayDate: on ? DEMO_TODAY : null }),
      setTelegramLinked: (telegramLinked) => set({ telegramLinked }),
      setSimulateFailure: (simulateFailure) => set({ simulateFailure }),
      setSimulateNight: (simulateNight) => set({ simulateNight }),
    }),
    { name: 'buddy.settings' },
  ),
)

/** Включён ли сегодня режим «Не мой день». */
export function useIsNotMyDay(): boolean {
  return useSettings((s) => s.notMyDayDate === DEMO_TODAY)
}

/**
 * Можно ли сейчас слать проактивные сообщения (модуль notifications из ideas.md).
 * Чат с ботом работает всегда, молчит только проактив.
 */
export function canNotifyNow(
  state: Pick<SettingsState, 'notMyDayDate' | 'simulateNight'>,
): boolean {
  return state.notMyDayDate !== DEMO_TODAY && !state.simulateNight
}
