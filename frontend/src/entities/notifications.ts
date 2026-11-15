import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, request } from '@/shared/api/http'
import { colleagueSchema } from './colleagues'
import { calendarBookingSchema } from './remote-calendar'
import { useSession } from './session'

const id = colleagueSchema.shape.id
const timestamp = z.iso.datetime({ offset: true })
export const notificationSchema = z.object({
  id,
  kind: z.enum(['booking_confirmed', 'meeting_reminder', 'mentor_answer']),
  booking_id: id.nullable(),
  escalation_id: id.nullable(),
  created_at: timestamp,
  read_at: timestamp.nullable(),
  starts_at: timestamp.nullable(),
  timezone: z.string().nullable(),
  person_name: z.string().nullable(),
  question_preview: z.string().nullable(),
})
export type Notification = z.infer<typeof notificationSchema>
export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  next_cursor: z.string().nullable(),
  unread_count: z.number().int().nonnegative(),
})
export const notificationResourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('booking'), booking: calendarBookingSchema }),
  z.object({
    type: z.literal('mentor_answer'),
    answer: z.object({ id, question: z.string(), answer_text: z.string(), answered_at: timestamp }),
  }),
])
export const notificationSettingsSchema = z.object({
  preferences: z.object({ meeting_reminders: z.boolean() }),
  work_days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  work_start: z.string().regex(/^\d{2}:\d{2}$/),
  work_end: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string(),
  version: z.number().int().nonnegative(),
})
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>
export type NotificationSettingsInput = Omit<NotificationSettings, 'timezone'>

function sameUser(userId: string) {
  if (useSession.getState().remote?.id !== userId)
    throw new ApiError(401, 'SESSION_CHANGED', 'Пользователь изменился. Открой уведомления заново')
}

export const remoteNotifications = {
  list: (cursor?: string, signal?: AbortSignal) =>
    request('/notifications', notificationPageSchema, { query: { limit: 20, cursor }, signal }),
  resource: (notificationId: string, signal?: AbortSignal) =>
    request(
      `/notifications/${encodeURIComponent(notificationId)}/resource`,
      notificationResourceSchema,
      { signal },
    ),
  read: (userId: string, notificationId: string) => {
    sameUser(userId)
    return request(
      `/notifications/${encodeURIComponent(notificationId)}/read`,
      notificationSchema,
      { method: 'PATCH' },
    )
  },
  settings: (signal?: AbortSignal) =>
    request('/me/settings', notificationSettingsSchema, { signal }),
  updateSettings: (userId: string, settings: NotificationSettingsInput) => {
    sameUser(userId)
    return request('/me/settings', notificationSettingsSchema, { method: 'PATCH', body: settings })
  },
}

export function useNotifications() {
  const userId = useSession((state) => state.remote?.id)
  return useInfiniteQuery({
    queryKey: ['notifications', userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => remoteNotifications.list(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    enabled: !!userId,
  })
}
export function useNotificationSettings() {
  const userId = useSession((state) => state.remote?.id)
  return useQuery({
    queryKey: ['notification-settings', userId],
    queryFn: ({ signal }) => remoteNotifications.settings(signal),
    enabled: !!userId,
  })
}
