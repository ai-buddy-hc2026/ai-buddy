import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import { IS_MOCK, request, tokenStore } from '@/shared/api/http'
import { mockDelay } from '@/shared/lib/storage'
import { mustEmployee, type Employee } from './employees'

export const roleSchema = z.enum(['intern', 'buddy', 'lead', 'hr'])
export type Role = z.infer<typeof roleSchema>

export interface TestUser {
  login: string
  role: Role
  employeeId: string
  /** Подпись на экране входа */
  hint: { ru: string; en: string }
}

/** Тестовые учётки из MVP (K-9). hr_dasha - для экранов HR из ideas.md (37, 38). */
export const TEST_USERS: readonly TestUser[] = [
  {
    login: 'intern_anya',
    role: 'intern',
    employeeId: 'anya',
    hint: { ru: 'Стажёр, неделя 2', en: 'Intern, week 2' },
  },
  {
    login: 'buddy_ilya',
    role: 'buddy',
    employeeId: 'ilya',
    hint: { ru: 'Наставник Ани', en: "Anya's mentor" },
  },
  {
    login: 'lead_maria',
    role: 'lead',
    employeeId: 'maria',
    hint: { ru: 'Руководитель команды', en: 'Team lead' },
  },
  {
    login: 'hr_dasha',
    role: 'hr',
    employeeId: 'dasha',
    hint: { ru: 'HR BP, видит только агрегаты', en: 'HR BP, aggregates only' },
  },
]

const loginResponseSchema = z.object({ token: z.string() })

interface SessionState {
  login: string | null
  signIn: (login: string) => Promise<void>
  signOut: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      login: null,
      signIn: async (login) => {
        if (!TEST_USERS.some((u) => u.login === login)) throw new Error('Нет такого пользователя')
        if (IS_MOCK) {
          await mockDelay(300)
        } else {
          const { token } = await request('/auth/mock-login', loginResponseSchema, {
            method: 'POST',
            body: { login },
          })
          tokenStore.set(token)
        }
        set({ login })
      },
      signOut: () => {
        tokenStore.clear()
        set({ login: null })
      },
    }),
    { name: 'buddy.session' },
  ),
)

export interface CurrentUser extends TestUser {
  employee: Employee
}

export function resolveUser(login: string | null): CurrentUser | null {
  const user = TEST_USERS.find((u) => u.login === login)
  return user ? { ...user, employee: mustEmployee(user.employeeId) } : null
}

/** Текущий пользователь или null, если не вошёл. */
export function useCurrentUser(): CurrentUser | null {
  return resolveUser(useSession((s) => s.login))
}

/** Для экранов под AppShell: пользователь точно есть (роутер не пустит без входа). */
export function useUser(): CurrentUser {
  const user = useCurrentUser()
  if (!user) throw new Error('Нужен вход')
  return user
}

/** Стажёр, наставник и руководитель демо-команды. */
export const DEMO = { internId: 'anya', mentorId: 'ilya', leadId: 'maria' } as const
