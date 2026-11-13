import { describe, expect, it } from 'vitest'
import type { Term } from './data'
import {
  askBuddyQuestion,
  formatDate,
  isStale,
  proposalDraft,
  searchTerms,
  validateProposal,
} from './logic'

const term = (id: string, name: string, overrides: Partial<Term> = {}): Term => ({
  id,
  term: name,
  synonyms: [],
  category: 'dev',
  definition: 'Простое объяснение',
  example: 'Пример',
  source: { title: 'Гайд', reviewedAt: '2026-10-12', ownerId: 'ilya' },
  ...overrides,
})

const TERMS: Term[] = [
  term('mr', 'МР', { synonyms: ['merge request'] }),
  term('duty', 'Дежурство', { category: 'process', synonyms: ['on-call'] }),
  term('alert', 'Алерт', {
    category: 'process',
    definition: 'Оповещение для дежурного о сбое',
  }),
  term('release', 'Релиз-трейн', { category: 'process', synonyms: ['поезд'] }),
]

describe('searchTerms', () => {
  it('returns all terms sorted alphabetically for an empty query', () => {
    const result = searchTerms(TERMS, '  ')

    expect(result.map((t) => t.id)).toEqual(['alert', 'duty', 'mr', 'release'])
  })

  it('finds by synonym case-insensitively', () => {
    const result = searchTerms(TERMS, 'MERGE')

    expect(result.map((t) => t.id)).toEqual(['mr'])
  })

  it('ranks name matches above definition matches', () => {
    // Arrange: «дежур» есть в названии одного и в объяснении другого
    const query = 'дежур'

    // Act
    const result = searchTerms(TERMS, query)

    // Assert
    expect(result.map((t) => t.id)).toEqual(['duty', 'alert'])
  })

  it('filters by category', () => {
    const result = searchTerms(TERMS, '', 'dev')

    expect(result.map((t) => t.id)).toEqual(['mr'])
  })

  it('returns empty list when nothing matches', () => {
    expect(searchTerms(TERMS, 'кубернетес')).toEqual([])
  })
})

describe('isStale', () => {
  it('marks documents older than 6 months as stale', () => {
    expect(isStale('2026-03-04', '2026-11-12')).toBe(true)
  })

  it('keeps recently reviewed documents fresh', () => {
    expect(isStale('2026-10-12', '2026-11-12')).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats ISO date as dd.mm.yyyy', () => {
    expect(formatDate('2026-10-12')).toBe('12.10.2026')
  })
})

describe('askBuddyQuestion', () => {
  it('builds a question for buddy', () => {
    expect(askBuddyQuestion('МР')).toBe('Что такое МР?')
  })
})

describe('validateProposal', () => {
  it('accepts a new term with a clear definition', () => {
    const result = validateProposal(
      { term: ' Стейдж ', definition: 'Тестовая среда до прода' },
      TERMS,
    )

    expect(result).toEqual({
      ok: true,
      proposal: { term: 'Стейдж', definition: 'Тестовая среда до прода' },
    })
  })

  it('rejects a term that already exists as a synonym', () => {
    const result = validateProposal({ term: 'On-Call', definition: 'Дежурство по сервису' }, TERMS)

    expect(result).toEqual({ ok: false, error: 'duplicate' })
  })

  it('rejects a too short term and a too short definition', () => {
    expect(validateProposal({ term: 'а', definition: 'Достаточно длинное' }, TERMS)).toEqual({
      ok: false,
      error: 'term',
    })
    expect(validateProposal({ term: 'Стейдж', definition: 'коротко' }, TERMS)).toEqual({
      ok: false,
      error: 'definition',
    })
  })
})

describe('proposalDraft', () => {
  it('creates a message draft with a stable idempotency key', () => {
    // Act
    const draft = proposalDraft({ term: 'Стейдж', definition: 'Тестовая среда' }, 'Илья')

    // Assert
    expect(draft.kind).toBe('message')
    expect(draft.idempotencyKey).toBe('glossary-стейдж')
    expect(draft.details).toContainEqual({ label: 'Кому', value: 'Илья' })
  })
})
