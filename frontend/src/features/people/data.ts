import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { getEmployee } from '@/entities/employees'
import { createCollection, mockDelay } from '@/shared/lib/storage'

/* ---------- Тематические чаты (идея 22, таблица interest_chats) ---------- */

export interface InterestChat {
  tag: string
  title: string
  members: number
  note: string
}

export const INTEREST_CHATS: readonly InterestChat[] = [
  { tag: 'футбол', title: 'Футбол в Авито', members: 40, note: 'Тренировки по средам' },
  { tag: 'настолки', title: 'Настолки по пятницам', members: 26, note: 'Пятница, 19:00, кухня' },
  { tag: 'бег', title: 'Бегуны Авито', members: 58, note: 'Забег по субботам' },
  { tag: 'велосипед', title: 'Велопокатушки', members: 21, note: 'Выезды по выходным' },
  { tag: 'йога', title: 'Йога в офисе', members: 33, note: 'Вторник и четверг, 9:00' },
  { tag: 'рисование', title: 'Скетчинг', members: 14, note: 'Рисуем в обед' },
]

/* ---------- Увлечения стажёра (user_interests) ---------- */

const interestsSchema = z.record(z.string(), z.array(z.string()))
const interestsDb = createCollection<Record<string, string[]>>('people.interests', () => ({}))

function readInterests(): Record<string, string[]> {
  const parsed = interestsSchema.safeParse(interestsDb.read())
  return parsed.success ? parsed.data : {}
}

export const interestsApi = {
  async get(userId: string): Promise<string[]> {
    await mockDelay(150)
    return readInterests()[userId] ?? getEmployee(userId)?.interests ?? []
  },
  async save(userId: string, tags: readonly string[]): Promise<string[]> {
    await mockDelay(250)
    interestsDb.write({ ...readInterests(), [userId]: [...tags] })
    return [...tags]
  },
}

const INTERESTS_KEY = ['people', 'interests'] as const

export function useInterests(userId: string) {
  return useQuery({ queryKey: [...INTERESTS_KEY, userId], queryFn: () => interestsApi.get(userId) })
}

export function useSaveInterests(userId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (tags: readonly string[]) => interestsApi.save(userId, tags),
    onSuccess: (tags) => client.setQueryData([...INTERESTS_KEY, userId], tags),
  })
}

/* ---------- Random coffee (coffee_pairs) ---------- */

const coffeeWeekSchema = z.object({
  skipped: z.boolean(),
  /** Предложенное время ISO «2026-11-13T15:00». null - ещё не предлагали */
  proposal: z.string().nullable(),
})
export type CoffeeWeek = z.infer<typeof coffeeWeekSchema>

const coffeeSchema = z.object({
  /** Пары прошлых недель: «anya+lena» */
  history: z.array(z.string()),
  weeks: z.record(z.string(), coffeeWeekSchema),
})
export type CoffeeState = z.infer<typeof coffeeSchema>

/** Стажёры других команд, которые сами включили random coffee (мок). */
export const COFFEE_OPTED_IN: readonly string[] = ['dima', 'lena']

const COFFEE_SEED: CoffeeState = { history: ['anya+lena'], weeks: {} }
const coffeeDb = createCollection<CoffeeState>('people.coffee', () => COFFEE_SEED)

function readCoffee(): CoffeeState {
  const parsed = coffeeSchema.safeParse(coffeeDb.read())
  return parsed.success ? parsed.data : COFFEE_SEED
}

export const EMPTY_WEEK: CoffeeWeek = { skipped: false, proposal: null }

export const coffeeApi = {
  async get(): Promise<CoffeeState> {
    await mockDelay(150)
    return readCoffee()
  },
  async setWeek(week: string, patch: Partial<CoffeeWeek>): Promise<CoffeeState> {
    await mockDelay(300)
    const state = readCoffee()
    const next: CoffeeState = {
      ...state,
      weeks: { ...state.weeks, [week]: { ...(state.weeks[week] ?? EMPTY_WEEK), ...patch } },
    }
    return coffeeDb.write(next)
  },
}

const COFFEE_KEY = ['people', 'coffee'] as const

export function useCoffee() {
  return useQuery({ queryKey: COFFEE_KEY, queryFn: coffeeApi.get })
}

export function useSetCoffeeWeek() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ week, patch }: { week: string; patch: Partial<CoffeeWeek> }) =>
      coffeeApi.setWeek(week, patch),
    onSuccess: (state) => client.setQueryData(COFFEE_KEY, state),
  })
}

/** Люди, у которых есть приёмные часы в моке календаря. */
export const OFFICE_HOURS_HOSTS: readonly string[] = ['ilya', 'maria', 'dasha']
