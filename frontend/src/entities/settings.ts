import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { IS_MOCK, errorMessage, request } from '@/shared/api/http'
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

/* ---------- remote: Go companion (GET/PATCH /settings, /day-mode, /channels/telegram) ---------- */

export const DEFAULT_TIMEZONE = 'Europe/Moscow'

export const remoteSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  lang: z.enum(['ru', 'en']),
  tone: z.enum(['short', 'detailed']),
  workHours: z.object({
    start: z.string(),
    end: z.string(),
    days: z.array(z.number().int()),
    timezone: z.string(),
  }),
  toggles: z.object({
    briefing: z.boolean(),
    hints: z.boolean(),
    birthdayReminders: z.boolean(),
    randomCoffee: z.boolean(),
    showInterests: z.boolean(),
  }),
  notMyDayDate: z.string().nullable(),
  telegramLinked: z.boolean(),
  buddyEnabled: z.boolean(),
})
export type RemoteSettings = z.infer<typeof remoteSettingsSchema>
export type RemoteSettingsInput = Omit<
  RemoteSettings,
  'notMyDayDate' | 'telegramLinked' | 'buddyEnabled'
>

const telegramLinkSchema = z.object({
  linked: z.boolean(),
  code: z.string().nullable(),
  deep_link: z.string().nullable().optional(),
})

export const remoteSettings = {
  get: () => request('/settings', remoteSettingsSchema),
  save: (input: RemoteSettingsInput) =>
    request('/settings', remoteSettingsSchema, { method: 'PATCH', body: input }),
  setDayMode: (enabled: boolean) =>
    request('/day-mode', remoteSettingsSchema, { method: 'POST', body: { enabled } }),
  /** Заглушка: реального бота нет, бэкенд сразу считает аккаунт привязанным. */
  setTelegram: (linked: boolean) =>
    linked
      ? request('/channels/telegram/link', telegramLinkSchema, { method: 'POST' })
      : request('/channels/telegram', telegramLinkSchema, { method: 'DELETE' }),
}

/* ---------- store ---------- */

interface SettingsData {
  theme: ThemeChoice
  lang: 'ru' | 'en'
  tone: Tone
  workHours: WorkHours
  timezone: string
  toggles: FeatureToggles
  /** Дата, на которую включён режим «Не мой день» (идея 44). null - выключен. */
  notMyDayDate: string | null
  telegramLinked: boolean
  /** false - стажёр в контрольной группе пилота (идея 38), проактив молчит. */
  buddyEnabled: boolean
  /** Ошибка синхронизации с Go API. В mock-режиме всегда null. */
  syncError: string | null
  /** Dev-панель: имитация сбоя сервиса «Отсутствия» для демо повтора. */
  simulateFailure: boolean
  /** Dev-панель: «сейчас ночь», чтобы показать отложенную доставку (идея 43). */
  simulateNight: boolean
}

interface SettingsState extends SettingsData {
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

/** Ответ сервера в поля стора. Сервер возвращает дату режима только за сегодня. */
export function fromRemote(remote: RemoteSettings): Partial<SettingsData> {
  const { timezone, ...workHours } = remote.workHours
  return {
    theme: remote.theme,
    lang: remote.lang,
    tone: remote.tone,
    workHours,
    timezone,
    toggles: remote.toggles,
    notMyDayDate: remote.notMyDayDate === null ? null : DEMO_TODAY,
    telegramLinked: remote.telegramLinked,
    buddyEnabled: remote.buddyEnabled,
    syncError: null,
  }
}

export function toRemoteInput(state: SettingsData): RemoteSettingsInput {
  return {
    theme: state.theme,
    lang: state.lang,
    tone: state.tone,
    workHours: { ...state.workHours, timezone: state.timezone },
    toggles: state.toggles,
  }
}

type Setter = (partial: Partial<SettingsData>) => void

/** Последний ответ побеждает: устаревшие ответы не перетирают новые правки. */
let syncSeq = 0

async function sync(set: Setter, call: () => Promise<RemoteSettings | null>): Promise<void> {
  if (IS_MOCK) return
  syncSeq += 1
  const seq = syncSeq
  try {
    const remote = await call()
    if (seq === syncSeq) set(remote ? fromRemote(remote) : { syncError: null })
  } catch (error) {
    if (seq === syncSeq) set({ syncError: errorMessage(error) })
  }
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => {
      const save = () => void sync(set, () => remoteSettings.save(toRemoteInput(get())))
      return {
        theme: 'system',
        lang: 'ru',
        tone: 'short',
        workHours: DEFAULT_WORK_HOURS,
        timezone: DEFAULT_TIMEZONE,
        toggles: {
          briefing: true,
          hints: true,
          birthdayReminders: false,
          randomCoffee: false,
          showInterests: false,
        },
        notMyDayDate: null,
        telegramLinked: false,
        buddyEnabled: true,
        syncError: null,
        simulateFailure: false,
        simulateNight: false,

        setTheme: (theme) => (set({ theme }), save()),
        setLang: (lang) => (set({ lang }), save()),
        setTone: (tone) => (set({ tone }), save()),
        setWorkHours: (workHours) => (set({ workHours }), save()),
        setToggle: (key, value) => (
          set((s) => ({ toggles: { ...s.toggles, [key]: value } })),
          save()
        ),
        setNotMyDay: (on) => {
          set({ notMyDayDate: on ? DEMO_TODAY : null })
          void sync(set, () => remoteSettings.setDayMode(on))
        },
        setTelegramLinked: (telegramLinked) => {
          set({ telegramLinked })
          void sync(set, async () => {
            const link = await remoteSettings.setTelegram(telegramLinked)
            set({ telegramLinked: link.linked })
            return null
          })
        },
        setSimulateFailure: (simulateFailure) => set({ simulateFailure }),
        setSimulateNight: (simulateNight) => set({ simulateNight }),
      }
    },
    {
      name: 'buddy.settings',
      /** Ошибку синхронизации не сохраняем между сессиями. */
      partialize: (state) => ({ ...state, syncError: null }),
    },
  ),
)

/** Загрузить настройки с сервера (в mock-режиме ничего не делает). */
export function loadRemoteSettings(): Promise<void> {
  return sync(useSettings.setState, () => remoteSettings.get())
}

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
