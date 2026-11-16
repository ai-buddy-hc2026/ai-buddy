import { z } from 'zod'
import type { ActionDraft } from '@/entities/actions'
import { DEMO_TODAY, parseIso } from '@/shared/lib/date'
import type { Term, TermCategory } from './data'

/** Документ старше этого срока помечаем «Может быть устаревшим» (идея 32). */
export const STALE_MONTHS = 6

export type CategoryFilter = TermCategory | 'all'

const normalize = (value: string): string => value.trim().toLowerCase().replaceAll('ё', 'е')

/** Чем меньше, тем выше в выдаче. null - не подходит. */
function rank(term: Term, query: string): number | null {
  const names = [term.term, ...term.synonyms].map(normalize)
  if (names.includes(query)) return 0
  if (names.some((name) => name.startsWith(query))) return 1
  if (names.some((name) => name.includes(query))) return 2
  if (normalize(term.definition).includes(query)) return 3
  return null
}

/** Поиск по термину, синонимам и объяснению без учёта регистра и «ё». */
export function searchTerms(
  terms: readonly Term[],
  query: string,
  category: CategoryFilter = 'all',
): Term[] {
  const q = normalize(query)
  const inCategory = terms.filter((term) => category === 'all' || term.category === category)
  if (q === '') return [...inCategory].sort((a, b) => a.term.localeCompare(b.term, 'ru'))
  return inCategory
    .map((term) => ({ term, score: rank(term, q) }))
    .filter((item): item is { term: Term; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.term.term.localeCompare(b.term.term, 'ru'))
    .map((item) => item.term)
}

export function isStale(
  reviewedAt: string,
  today: string = DEMO_TODAY,
  months: number = STALE_MONTHS,
): boolean {
  const limit = parseIso(today)
  limit.setMonth(limit.getMonth() - months)
  return parseIso(reviewedAt).getTime() < limit.getTime()
}

/** «12.10.2026» */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function askBuddyQuestion(term: string): string {
  return `Что такое ${term}?`
}

export const proposalSchema = z.object({
  term: z.string().trim().min(2).max(40),
  definition: z.string().trim().min(10).max(300),
})
export type Proposal = z.infer<typeof proposalSchema>

export type ProposalError = 'term' | 'definition' | 'duplicate'

export function validateProposal(
  input: { term: string; definition: string },
  terms: readonly Term[],
): { ok: true; proposal: Proposal } | { ok: false; error: ProposalError } {
  const parsed = proposalSchema.safeParse(input)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return { ok: false, error: field === 'term' ? 'term' : 'definition' }
  }
  const key = normalize(parsed.data.term)
  const exists = terms.some((t) => [t.term, ...t.synonyms].map(normalize).includes(key))
  return exists ? { ok: false, error: 'duplicate' } : { ok: true, proposal: parsed.data }
}

/** Черновик сообщения владельцу словаря. Отправка только по кнопке. */
export function proposalDraft(proposal: Proposal, ownerName: string): ActionDraft {
  return {
    kind: 'message',
    title: `Новый термин для словаря: ${proposal.term}`,
    details: [
      { label: 'Термин', value: proposal.term },
      { label: 'Объяснение', value: proposal.definition },
      { label: 'Кому', value: ownerName },
    ],
    idempotencyKey: `glossary-${normalize(proposal.term)}`,
  }
}
