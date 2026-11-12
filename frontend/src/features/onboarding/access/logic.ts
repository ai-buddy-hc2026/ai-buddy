import { z } from 'zod'
import { DEMO_TODAY, daysUntil } from '@/shared/lib/date'

/**
 * Пакет доступов по роли (идея 27): шаблон роли минус выданные и запрошенные = недостающие.
 * Одна заявка на все недостающие, статусы обновляются в моке по таймеру.
 */
export interface AccessDef {
  id: string
  title: string
  about: string
  /** Кто согласует: id из мока сотрудников */
  approverId: string
  /** Через сколько секунд мок сам выдаст доступ. null - нужно ручное согласование */
  grantAfterSec: number | null
}

export const requestItemSchema = z.object({
  accessId: z.string(),
  grantAfterSec: z.number().int().min(0).nullable(),
})

export const accessRequestSchema = z.object({
  id: z.string(),
  /** Номер заявки во внешнем сервисе (из истории действий), например ACC-1042 */
  externalId: z.string(),
  /** Время создания, ISO с временем */
  createdAt: z.string(),
  items: z.array(requestItemSchema).min(1),
})
export type AccessRequest = z.infer<typeof accessRequestSchema>

export const accessStateSchema = z.object({
  granted: z.array(z.string()),
  requests: z.array(accessRequestSchema),
})
export type AccessState = z.infer<typeof accessStateSchema>

export type AccessStatus = 'granted' | 'pending' | 'missing'

export interface AccessItem {
  access: AccessDef
  status: AccessStatus
  /** Номер заявки, если доступ запрошен */
  requestId: string | null
  /** Сколько дней заявка висит на согласовании */
  pendingDays: number
}

/** Блокер для сводки наставнику (идея 36): заявка висит дольше 2 дней. */
export const STUCK_DAYS = 2

function isItemGranted(
  item: z.infer<typeof requestItemSchema>,
  createdAt: string,
  nowMs: number,
): boolean {
  if (item.grantAfterSec === null) return false
  return nowMs - new Date(createdAt).getTime() >= item.grantAfterSec * 1000
}

/** Статус каждого доступа из шаблона роли на момент nowMs. */
export function resolveAccess(
  state: AccessState,
  template: readonly AccessDef[],
  nowMs: number,
  today = DEMO_TODAY,
): AccessItem[] {
  return template.map((access) => {
    if (state.granted.includes(access.id))
      return { access, status: 'granted', requestId: null, pendingDays: 0 }
    const request = [...state.requests]
      .reverse()
      .find((r) => r.items.some((i) => i.accessId === access.id))
    const item = request?.items.find((i) => i.accessId === access.id)
    if (!request || !item) return { access, status: 'missing', requestId: null, pendingDays: 0 }
    const status: AccessStatus = isItemGranted(item, request.createdAt, nowMs)
      ? 'granted'
      : 'pending'
    const pendingDays =
      status === 'pending' ? Math.max(0, -daysUntil(request.createdAt.slice(0, 10), today)) : 0
    return { access, status, requestId: request.externalId, pendingDays }
  })
}

export function missingOf(items: readonly AccessItem[]): AccessDef[] {
  return items.filter((i) => i.status === 'missing').map((i) => i.access)
}

/** Есть заявки, которые мок выдаст сам: экран опрашивает статусы. */
export function hasAutoPending(items: readonly AccessItem[]): boolean {
  return items.some((i) => i.status === 'pending' && i.access.grantAfterSec !== null)
}

export function isStuck(item: AccessItem): boolean {
  return item.status === 'pending' && item.pendingDays >= STUCK_DAYS
}

export function countByStatus(items: readonly AccessItem[]): Record<AccessStatus, number> {
  return {
    granted: items.filter((i) => i.status === 'granted').length,
    pending: items.filter((i) => i.status === 'pending').length,
    missing: items.filter((i) => i.status === 'missing').length,
  }
}

/** Ключ шаблона по должности из мока сотрудников: «Стажёр Backend» -> backend. */
export function roleKey(position: string): string {
  const lower = position.toLowerCase()
  if (lower.includes('frontend')) return 'frontend'
  if (lower.includes('аналит') || lower.includes('analyst')) return 'analyst'
  return 'backend'
}

/** Новая заявка: одна на все выбранные доступы. Состояние не мутируется. */
export function addRequest(
  state: AccessState,
  picked: readonly AccessDef[],
  meta: { id: string; externalId: string; createdAt: string },
): AccessState {
  if (picked.length === 0) return state
  const request: AccessRequest = {
    ...meta,
    items: picked.map((a) => ({ accessId: a.id, grantAfterSec: a.grantAfterSec })),
  }
  return { ...state, requests: [...state.requests, request] }
}
