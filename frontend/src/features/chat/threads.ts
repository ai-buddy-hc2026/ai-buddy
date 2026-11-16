import { EMPLOYEES, getEmployee, type Employee } from '@/entities/employees'
import type { Message } from './model'

/** Список чатов: бот закреплён сверху, ниже группа стажёров и коллеги. */
export const BUDDY_ID = 'buddy'
export const GROUP_ID = 'interns'

export type ThreadInfo =
  | { id: typeof BUDDY_ID; kind: 'bot' }
  | { id: typeof GROUP_ID; kind: 'group'; members: Employee[] }
  | { id: string; kind: 'direct'; employee: Employee }

function internsOf(): Employee[] {
  return EMPLOYEES.filter((e) => e.kind === 'intern')
}

/** Наставник стажёра: наставник его команды. У остальных ролей его нет. */
export function mentorOf(self: Employee): Employee | null {
  if (self.kind !== 'intern') return null
  return EMPLOYEES.find((e) => e.kind === 'mentor' && e.teamId === self.teamId) ?? null
}

/** Все, с кем можно начать переписку через «+». */
export function contactsOf(self: Employee): Employee[] {
  return EMPLOYEES.filter((e) => e.id !== self.id)
}

/** Поиск по имени, роли и команде без учёта регистра. */
export function matchContact(employee: Employee, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [employee.name, employee.role, employee.teamName].some((field) =>
    field.toLowerCase().includes(needle),
  )
}

/**
 * Список чатов: buddy, группа стажёров (идея 34, только для стажёров), наставник.
 * Остальные личные чаты появляются, когда переписка начата через «+» (openIds).
 */
export function listThreads(self: Employee, openIds: readonly string[] = []): ThreadInfo[] {
  const group: ThreadInfo[] =
    self.kind === 'intern' ? [{ id: GROUP_ID, kind: 'group', members: internsOf() }] : []
  const mentor = mentorOf(self)
  const directIds = [...(mentor ? [mentor.id] : []), ...openIds]
  const direct: ThreadInfo[] = []
  for (const id of directIds) {
    if (direct.some((th) => th.id === id)) continue
    const employee = getEmployee(id)
    if (employee && employee.id !== self.id) direct.push({ id, kind: 'direct', employee })
  }
  return [{ id: BUDDY_ID, kind: 'bot' }, ...group, ...direct]
}

export function findThread(id: string | undefined, self: Employee): ThreadInfo | null {
  if (!id) return null
  if (id === BUDDY_ID) return { id: BUDDY_ID, kind: 'bot' }
  if (id === GROUP_ID)
    return self.kind === 'intern' ? { id: GROUP_ID, kind: 'group', members: internsOf() } : null
  const employee = getEmployee(id)
  return employee && employee.id !== self.id ? { id, kind: 'direct', employee } : null
}

/* ---------- Начальные переписки ---------- */

/** Тестовых сообщений нет: в группе только правила, остальные чаты пустые. */
export const SEED_THREADS: Record<string, Message[]> = {
  [BUDDY_ID]: [],
  [GROUP_ID]: [
    {
      id: 'seed-g0',
      from: 'bot',
      authorId: null,
      text: 'Правила группы: здесь только стажёры, наставников и руководителей нет. Спрашивай что угодно, отвечаем по-доброму',
      at: '2026-11-02T09:00:00',
    },
  ],
}
