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

/** Группа только для стажёров (идея 34): наставники и руководители её не видят. */
export function listThreads(self: Employee): ThreadInfo[] {
  const direct: ThreadInfo[] = EMPLOYEES.filter((e) => e.id !== self.id).map((employee) => ({
    id: employee.id,
    kind: 'direct',
    employee,
  }))
  const group: ThreadInfo[] =
    self.kind === 'intern' ? [{ id: GROUP_ID, kind: 'group', members: internsOf() }] : []
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

/* ---------- Seed переписок (тестовые данные) ---------- */

const peer = (id: string, authorId: string, text: string, at: string): Message => ({
  id,
  from: 'peer',
  authorId,
  text,
  at,
})
const me = (id: string, text: string, at: string): Message => ({
  id,
  from: 'me',
  authorId: null,
  text,
  at,
})

export const SEED_THREADS: Record<string, Message[]> = {
  [BUDDY_ID]: [],
  ilya: [
    peer(
      'seed-i1',
      'ilya',
      'Привет! Как вторая неделя? Если застрянешь с окружением - пиши сразу',
      '2026-11-11T10:05:00',
    ),
    me('seed-i2', 'Привет! Всё норм, разбираюсь с make dev', '2026-11-11T10:12:00'),
    peer(
      'seed-i3',
      'ilya',
      'Отлично. В пятницу встреча 1:1 в 16:00, обсудим первую задачу',
      '2026-11-11T10:14:00',
    ),
  ],
  oleg: [
    peer('seed-o1', 'oleg', 'Доступ к Grafana выдал, проверь', '2026-11-10T15:40:00'),
    me('seed-o2', 'Работает, спасибо!', '2026-11-10T15:52:00'),
  ],
  sveta: [
    peer(
      'seed-s1',
      'sveta',
      'Если для задачи понадобятся тестовые данные по объявлениям - пиши, скину выгрузку',
      '2026-11-12T09:30:00',
    ),
  ],
  [GROUP_ID]: [
    {
      id: 'seed-g0',
      from: 'bot',
      authorId: null,
      text: 'Правила группы: здесь только стажёры, наставников и руководителей нет. Спрашивай что угодно, отвечаем по-доброму',
      at: '2026-11-02T09:00:00',
    },
    peer('seed-g1', 'dima', 'кто-нибудь уже проходил курс по Go?', '2026-11-12T11:02:00'),
    peer('seed-g2', 'lena', 'я на середине, норм курс, задачки полезные', '2026-11-12T11:05:00'),
  ],
}
