import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK, request } from '@/shared/api/http'

/**
 * Входящие проактивного бота (идеи 23, 24, 25, 10, 15, 20). Очередь пишет планировщик Go,
 * уже с учётом тумблеров, рабочих часов и «Не мой день». В mock-режиме список пуст.
 */
export const notificationSchema = z.object({
  id: z.string(),
  feature: z.enum(['briefing', 'hints', 'stuck', 'reminders', 'coffee', 'birthday', 'system']),
  title: z.string(),
  body: z.string(),
  deliver_at: z.string(),
  read_at: z.string().nullable(),
  created_at: z.string(),
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  unread_count: z.number().int(),
})
export type NotificationPage = z.infer<typeof notificationPageSchema>

const EMPTY_PAGE: NotificationPage = { items: [], unread_count: 0 }

export const remoteNotifications = {
  list: (unreadOnly = false) =>
    request('/notifications', notificationPageSchema, {
      query: unreadOnly ? { unread: 'true' } : {},
    }),
  markRead: (id: string) =>
    request(`/notifications/${encodeURIComponent(id)}/read`, notificationSchema, {
      method: 'POST',
    }),
}

const KEY = ['notifications'] as const
const REFRESH_MS = 60_000

export function useNotifications() {
  return useQuery({
    queryKey: KEY,
    queryFn: (): Promise<NotificationPage> =>
      IS_MOCK ? Promise.resolve(EMPTY_PAGE) : remoteNotifications.list(),
    refetchInterval: IS_MOCK ? false : REFRESH_MS,
  })
}

export function useMarkNotificationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => remoteNotifications.markRead(id),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
