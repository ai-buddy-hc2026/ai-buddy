import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, request } from '@/shared/api/http'
import { colleagueSchema } from './colleagues'
import { useSession } from './session'

const id = colleagueSchema.shape.id
export const calendarSlotSchema = z.object({
  id,
  employee_id: id,
  host_name: z.string(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  timezone: z.string(),
})
export type CalendarSlot = z.infer<typeof calendarSlotSchema>
export const calendarBookingSchema = calendarSlotSchema.extend({
  slot_id: id,
  attendee_id: id,
  attendee_name: z.string(),
  topic: z.string(),
  status: z.literal('confirmed'),
  confirmed_at: z.iso.datetime({ offset: true }),
})
export type CalendarBooking = z.infer<typeof calendarBookingSchema>

const draftSchema = z.object({
  slot_id: id,
  topic: z.string().trim().min(1).max(500),
  idempotency_key: id,
})
export type CalendarDraft = z.infer<typeof draftSchema>
const draftKey = (userId: string, slotId: string) => `buddy.calendar-draft:${userId}:${slotId}`

export function readCalendarDraft(userId: string, slotId: string): CalendarDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, slotId))
    const parsed = draftSchema.safeParse(raw ? JSON.parse(raw) : null)
    return parsed.success && parsed.data.slot_id === slotId ? parsed.data : null
  } catch {
    return null
  }
}

/** Сохраняется до POST: обрыв связи и перезагрузка не создают новый ключ повтора. */
export function prepareCalendarDraft(userId: string, slotId: string, topic: string): CalendarDraft {
  const saved = readCalendarDraft(userId, slotId)
  if (saved) {
    if (saved.topic !== topic.trim())
      throw new Error('Сначала проверь результат предыдущего подтверждения')
    return saved
  }
  const draft = draftSchema.parse({
    slot_id: slotId,
    topic: topic.trim(),
    idempotency_key: crypto.randomUUID(),
  })
  try {
    localStorage.setItem(draftKey(userId, slotId), JSON.stringify(draft))
  } catch {
    throw new Error('Не удалось сохранить подтверждение в браузере. Запись не отправлена')
  }
  return draft
}

export function clearCalendarDraft(userId: string, slotId: string) {
  try {
    localStorage.removeItem(draftKey(userId, slotId))
  } catch {
    /* Сохранённый ключ остаётся безопасным для повтора. */
  }
}

export const remoteCalendar = {
  slots: (employeeId: string, signal?: AbortSignal) =>
    request(
      `/calendar/${encodeURIComponent(employeeId)}/office-hours`,
      z.object({ items: z.array(calendarSlotSchema) }),
      { signal },
    ),
  bookings: (signal?: AbortSignal) =>
    request('/calendar/bookings', z.object({ items: z.array(calendarBookingSchema) }), { signal }),
  book: (userId: string, draft: CalendarDraft) => {
    if (useSession.getState().remote?.id !== userId)
      throw new ApiError(401, 'SESSION_CHANGED', 'Пользователь изменился. Открой календарь заново')
    return request('/calendar/bookings', calendarBookingSchema, {
      method: 'POST',
      headers: { 'Idempotency-Key': draft.idempotency_key },
      body: { slot_id: draft.slot_id, topic: draft.topic, confirmed: true },
    })
  },
}

export function useCalendarSlots(employeeId: string) {
  const userId = useSession((state) => state.remote?.id)
  return useQuery({
    queryKey: ['calendar', userId, 'slots', employeeId],
    queryFn: ({ signal }) => remoteCalendar.slots(employeeId, signal),
    enabled: !!userId && !!employeeId,
  })
}
export function useCalendarBookings() {
  const userId = useSession((state) => state.remote?.id)
  return useQuery({
    queryKey: ['calendar', userId, 'bookings'],
    queryFn: ({ signal }) => remoteCalendar.bookings(signal),
    enabled: !!userId,
  })
}

export function formatCalendarTime(start: string, timezone: string, lang = 'ru'): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ru-RU', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(start))
}
