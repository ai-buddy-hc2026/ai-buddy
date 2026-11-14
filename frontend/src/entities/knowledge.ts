import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { IS_MOCK } from '@/shared/api/http'
import { remoteKnowledge } from './remote'

/**
 * Источник ответа из базы знаний команды (GET /knowledge/search, sources[] в чате).
 * revision - снимок версии документа на момент ответа, не текущая редакция.
 */
export const knowledgeSourceSchema = z.object({
  docId: z.string(),
  revision: z.number().int(),
  title: z.string(),
  section: z.string(),
  url: z.string(),
})
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>

export interface KnowledgeHit {
  source: KnowledgeSource
  content: string
}

export const MAX_QUERY_LENGTH = 250

export const knowledgeApi = {
  /** Только реальный режим: в демо поиск по базе знаний делает мок-бот (features/chat/kb.ts). */
  async search(query: string): Promise<KnowledgeHit[]> {
    const q = query.trim().slice(0, MAX_QUERY_LENGTH)
    if (IS_MOCK || q.length === 0) return []
    return remoteKnowledge.search(q)
  },
}

export function useKnowledgeSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['knowledge', q] as const,
    queryFn: () => knowledgeApi.search(q),
    enabled: !IS_MOCK && q.length > 0,
  })
}
