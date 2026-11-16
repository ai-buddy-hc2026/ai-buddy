import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { createCollection, mockDelay, newId } from '@/shared/lib/storage'

/** Brag document (идея 29): достижения собираются сами, стажёр может добавить или удалить запись. */
export const bragItemSchema = z.object({
  id: z.string(),
  type: z.enum(['task', 'pr', 'review', 'feedback', 'manual']),
  title: z.string(),
  link: z.string().nullable(),
  date: z.string(),
})
export type BragItem = z.infer<typeof bragItemSchema>

const SEED: BragItem[] = [
  { id: 'b1', type: 'task', title: 'Прошла вводный курс за 2 дня', link: null, date: '2026-11-04' },
  {
    id: 'b2',
    type: 'task',
    title: 'Получила доступ к GitLab и склонировала сервис',
    link: null,
    date: '2026-11-05',
  },
  {
    id: 'b3',
    type: 'review',
    title: 'Илья: «быстро разобралась со структурой сервиса»',
    link: null,
    date: '2026-11-06',
  },
  {
    id: 'b4',
    type: 'pr',
    title: 'MR !412: поправила опечатки в README сервиса',
    link: 'https://gitlab.test/ads/-/merge_requests/412',
    date: '2026-11-10',
  },
]

const bragDb = createCollection<BragItem[]>('brag', () => SEED)

export function toMarkdown(items: readonly BragItem[], owner: string): string {
  const lines = [...items]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => `- ${item.date} · ${item.title}${item.link ? ` (${item.link})` : ''}`)
  return [`# Достижения: ${owner}`, '', ...lines, ''].join('\n')
}

export const bragApi = {
  async list(): Promise<BragItem[]> {
    await mockDelay(150)
    return z.array(bragItemSchema).parse(bragDb.read())
  },
  async add(item: Omit<BragItem, 'id'>): Promise<BragItem> {
    await mockDelay(150)
    const created = { ...item, id: newId('brag') }
    bragDb.update((list) => [created, ...list])
    return created
  },
  async remove(id: string): Promise<void> {
    await mockDelay(100)
    bragDb.update((list) => list.filter((item) => item.id !== id))
  },
}

export const BRAG_KEY = ['brag'] as const

export function useBrag() {
  return useQuery({ queryKey: BRAG_KEY, queryFn: bragApi.list })
}

export function useAddBrag() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (item: Omit<BragItem, 'id'>) => bragApi.add(item),
    onSuccess: () => client.invalidateQueries({ queryKey: BRAG_KEY }),
  })
}

export function useRemoveBrag() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => bragApi.remove(id),
    onSuccess: () => client.invalidateQueries({ queryKey: BRAG_KEY }),
  })
}
