import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, IS_MOCK, request } from '@/shared/api/http'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'
import { employeeIdForUser } from './directory'

/**
 * Мок календаря (идея 6): приёмные часы наставника, тимлида, HR BP.
 * Стажёр видит только приёмные слоты, а не весь календарь человека.
 */
export const slotSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  /** ISO без таймзоны: 2026-11-12T11:00 */
  start: z.string(),
  minutes: z.number().int(),
  /** Кто занял. null - свободен */
  bookedBy: z.string().nullable(),
  topic: z.string(),
})
export type Slot = z.infer<typeof slotSchema>

export const bookingSchema = z.object({
  id: z.string(),
  slotId: z.string(),
  employeeId: z.string(),
  attendeeId: z.string(),
  start: z.string(),
  topic: z.string(),
})
export type Booking = z.infer<typeof bookingSchema>

const slot = (
  id: string,
  employeeId: string,
  start: string,
  bookedBy: string | null = null,
): Slot => ({
  id,
  employeeId,
  start,
  minutes: 30,
  bookedBy,
  topic: bookedBy ? '1:1' : '',
})

const SEED: Slot[] = [
  slot('s-ilya-0', 'ilya', '2026-11-12T14:00', 'anya'),
  slot('s-ilya-1', 'ilya', '2026-11-17T15:00'),
  slot('s-ilya-2', 'ilya', '2026-11-19T11:00'),
  slot('s-ilya-3', 'ilya', '2026-11-20T16:30'),
  slot('s-maria-1', 'maria', '2026-11-16T12:00'),
  slot('s-maria-2', 'maria', '2026-11-18T17:00'),
  slot('s-dasha-1', 'dasha', '2026-11-13T11:30'),
  slot('s-dasha-2', 'dasha', '2026-11-17T10:00'),
  slot('s-dasha-3', 'dasha', '2026-11-19T14:00', 'lena'),
]

const slotsDb = createCollection<Slot[]>('slots', () => SEED)

export function freeSlots(slots: readonly Slot[], employeeId: string): Slot[] {
  return slots.filter((s) => s.employeeId === employeeId && s.bookedBy === null)
}

/** Бронь слота. Слот уже занят - ошибка 409, как в моке календаря. */
export function bookSlot(
  slots: readonly Slot[],
  slotId: string,
  attendeeId: string,
  topic: string,
): { slots: Slot[]; booking: Booking } {
  const target = slots.find((s) => s.id === slotId)
  if (!target) throw new ApiError(404, 'not_found', 'Такого слота нет')
  if (target.bookedBy !== null) throw new ApiError(409, 'conflict', 'Слот уже занят. Выбери другой')
  return {
    slots: slots.map((s) => (s.id === slotId ? { ...s, bookedBy: attendeeId, topic } : s)),
    booking: {
      id: newId('book'),
      slotId,
      employeeId: target.employeeId,
      attendeeId,
      start: target.start,
      topic,
    },
  }
}

/* ---------- Go API (backend/internal/mocks) ---------- */

const apiSlotSchema = z.object({
  id: z.string(),
  host_code: z.string(),
  starts_at: z.string(),
  minutes: z.number().int(),
  booked_by: z.string().nullable().optional(),
  topic: z.string().optional(),
})
const apiSlotPageSchema = z.object({ items: z.array(apiSlotSchema) })
const apiBookingSchema = z.object({
  id: z.string(),
  slot_id: z.string(),
  host_code: z.string(),
  attendee_id: z.string(),
  starts_at: z.string(),
  topic: z.string(),
})

const pad2 = (n: number) => String(n).padStart(2, '0')

/** UTC из API -> локальное «2026-11-12T11:00», как в моке. */
export function toLocalStart(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function toSlot(item: z.infer<typeof apiSlotSchema>): Slot {
  return {
    id: item.id,
    employeeId: item.host_code,
    start: toLocalStart(item.starts_at),
    minutes: item.minutes,
    bookedBy: item.booked_by ? employeeIdForUser(item.booked_by) : null,
    topic: item.topic ?? '',
  }
}

export const remoteCalendar = {
  async officeHours(employeeId: string): Promise<Slot[]> {
    const page = await request(
      `/calendar/${encodeURIComponent(employeeId)}/office-hours`,
      apiSlotPageSchema,
    )
    return page.items.map(toSlot)
  },
  /** Бэкенд отдаёт брони текущего пользователя по токену. */
  async myBookings(): Promise<Slot[]> {
    const page = await request('/calendar/bookings', apiSlotPageSchema)
    return page.items.map(toSlot)
  },
  async book(slotId: string, topic: string): Promise<Booking> {
    const b = await request('/calendar/bookings', apiBookingSchema, {
      method: 'POST',
      body: { slot_id: slotId, topic },
    })
    return {
      id: b.id,
      slotId: b.slot_id,
      employeeId: b.host_code,
      attendeeId: employeeIdForUser(b.attendee_id),
      start: toLocalStart(b.starts_at),
      topic: b.topic,
    }
  },
}

export const calendarApi = {
  /** GET /calendar/{employee_id}/office-hours */
  async officeHours(employeeId: string): Promise<Slot[]> {
    if (!IS_MOCK) return remoteCalendar.officeHours(employeeId)
    await mockDelay(200)
    return z.array(slotSchema).parse(freeSlots(slotsDb.read(), employeeId))
  },
  /** Встречи человека: занятые им слоты */
  async bookingsOf(attendeeId: string): Promise<Slot[]> {
    if (!IS_MOCK) return remoteCalendar.myBookings()
    await mockDelay(150)
    return slotsDb.read().filter((s) => s.bookedBy === attendeeId)
  },
  /** POST /calendar/bookings {slot_id, attendee_id, topic} */
  async book(slotId: string, attendeeId: string, topic: string): Promise<Booking> {
    if (!IS_MOCK) return remoteCalendar.book(slotId, topic)
    await mockDelay(500)
    const result = bookSlot(slotsDb.read(), slotId, attendeeId, topic)
    slotsDb.write(result.slots)
    return result.booking
  },
  peekFree: (employeeId: string): Slot[] => freeSlots(slotsDb.read(), employeeId),
}

export const SLOTS_KEY = ['slots'] as const

export function useOfficeHours(employeeId: string) {
  return useQuery({
    queryKey: [...SLOTS_KEY, 'free', employeeId],
    queryFn: () => calendarApi.officeHours(employeeId),
  })
}

export function useMyBookings(attendeeId: string) {
  return useQuery({
    queryKey: [...SLOTS_KEY, 'mine', attendeeId],
    queryFn: () => calendarApi.bookingsOf(attendeeId),
  })
}

export function useBookSlot() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      slotId,
      attendeeId,
      topic,
    }: {
      slotId: string
      attendeeId: string
      topic: string
    }) => calendarApi.book(slotId, attendeeId, topic),
    // И при успехе, и при 409 список слотов устарел
    onSettled: () => client.invalidateQueries({ queryKey: SLOTS_KEY }),
  })
}

/** «чт, 19.11 в 11:00» */
export function formatSlot(start: string, lang: 'ru' | 'en' = 'ru'): string {
  const date = new Date(start)
  const days =
    lang === 'en'
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${days[date.getDay()]}, ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return lang === 'en' ? `${day} at ${time}` : `${day} в ${time}`
}
