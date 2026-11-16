import { z } from 'zod'
import { DEMO_TODAY, addDays, daysUntil } from '@/shared/lib/date'
import { createCollection } from '@/shared/lib/storage'

/**
 * Пребординг (идея 5): блок `first_day` из профиля стажёра в моке сотрудников.
 * Адрес и офис выдуманы, данные тестовые.
 */
export const firstDaySchema = z.object({
  date: z.string(),
  time: z.string(),
  address: z.string(),
  entrance: z.string(),
  pass: z.string(),
  floor: z.number().int(),
  parking: z.string(),
  greeterId: z.string(),
  /** Куда идти после встречи: точка на карте офиса */
  deskId: z.string(),
  bring: z.array(z.object({ id: z.string(), title: z.string(), isRequired: z.boolean() })),
  steps: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })).length(4),
})
export type FirstDay = z.infer<typeof firstDaySchema>

export const FIRST_DAY: FirstDay = firstDaySchema.parse({
  date: '2026-11-02',
  time: '10:00',
  address: 'Тестовый БЦ, Лесная улица, 7',
  entrance: 'Вход с Лесной улицы',
  pass: 'Пропуск на ресепшене по паспорту',
  floor: 3,
  parking: 'Парковки для гостей нет, ближайшее метро в 5 минутах',
  greeterId: 'ilya',
  deskId: 'desk-anya',
  bring: [
    { id: 'passport', title: 'Паспорт', isRequired: true },
    { id: 'snils', title: 'СНИЛС и ИНН для HR', isRequired: true },
    { id: 'phone', title: 'Телефон с Telegram для 2FA', isRequired: true },
    { id: 'headphones', title: 'Наушники', isRequired: false },
    { id: 'bottle', title: 'Бутылка для воды', isRequired: false },
  ],
  steps: [
    { id: 'entrance', title: 'Вход с Лесной улицы', text: 'Стеклянные двери под вывеской БЦ' },
    { id: 'reception', title: 'Ресепшен', text: 'Покажи паспорт, получишь временный пропуск' },
    { id: 'lift', title: 'Лифты', text: 'Поднимись на 3 этаж' },
    { id: 'greeter', title: 'Встреча', text: 'У лифтов ждёт Илья и проводит к столу' },
  ],
})

export type StartPhase = 'past' | 'today' | 'tomorrow' | 'soon'

export function startPhase(date: string, today = DEMO_TODAY): StartPhase {
  const diff = daysUntil(date, today)
  if (diff < 0) return 'past'
  if (diff === 0) return 'today'
  return diff === 1 ? 'tomorrow' : 'soon'
}

/** Крон отправляет напоминание за день до старта в 12:00. */
export function reminderSendAt(date: string): string {
  return `${addDays(date, -1)}T12:00`
}

/** Текст напоминания строится только из данных профиля, без выдумок. */
export function buildReminder(day: FirstDay, greeterShort: string): string {
  const required = day.bring.filter((item) => item.isRequired).map((item) => lowerFirst(item.title))
  const what = required.length > 0 ? `, возьми ${required.join(', ')}` : ''
  return `Завтра к ${day.time}, ${lowerFirst(day.entrance)}, ${lowerFirst(day.pass)}${what}. Тебя встретит ${greeterShort}`
}

/** «Паспорт» -> «паспорт», аббревиатуры («СНИЛС») не трогаем. */
export function lowerFirst(text: string): string {
  const second = text.charAt(1)
  return second !== '' && second === second.toLowerCase() && second !== second.toUpperCase()
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text
}

/* ---------- Чек-лист «Что взять»: личные отметки стажёра ---------- */

const checkedSchema = z.array(z.string())
const checkedDb = createCollection<string[]>('first-day.checked', () => [])

export function readChecked(): string[] {
  const parsed = checkedSchema.safeParse(checkedDb.read())
  return parsed.success ? parsed.data : []
}

export function saveChecked(ids: readonly string[]): void {
  checkedDb.write([...ids])
}

export function toggleChecked(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}
