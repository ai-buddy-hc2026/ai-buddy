import { describe, expect, it } from 'vitest'
import type { Term } from '@/entities/glossary'
import { findTerms, splitByTerms } from './terms'

function term(id: string, name: string, synonyms: string[] = []): Term {
  return {
    id,
    term: name,
    synonyms,
    category: 'dev',
    definition: `Объяснение ${name}`,
    example: '',
    source: { title: 'Тест', reviewedAt: '2026-10-01', ownerId: 'ilya' },
  }
}

const MR = term('mr', 'МР', ['merge request'])
const REVIEW = term('review', 'Ревью', ['code review'])
const PROD = term('prod', 'Прод', ['продакшен'])
const TERMS = [MR, REVIEW, PROD]

describe('splitByTerms', () => {
  it('returns plain text when there are no terms', () => {
    expect(splitByTerms('Привет, как дела?', TERMS)).toEqual([
      { kind: 'text', text: 'Привет, как дела?' },
    ])
  })

  it('highlights a synonym case-insensitively and keeps original casing', () => {
    // Arrange
    const text = 'Открой Merge Request в GitLab'

    // Act
    const segments = splitByTerms(text, TERMS)

    // Assert
    expect(segments).toEqual([
      { kind: 'text', text: 'Открой ' },
      { kind: 'term', text: 'Merge Request', term: MR },
      { kind: 'text', text: ' в GitLab' },
    ])
  })

  it('highlights only the first occurrence of a term', () => {
    const segments = splitByTerms('МР готов. Второй МР позже', TERMS)

    expect(segments.filter((s) => s.kind === 'term')).toHaveLength(1)
    expect(segments.map((s) => s.text).join('')).toBe('МР готов. Второй МР позже')
  })

  it('respects word boundaries in Cyrillic', () => {
    expect(findTerms('Продукт и продажи', TERMS)).toEqual([])
    expect(findTerms('Катнули в прод.', TERMS).map((m) => m.term.id)).toEqual(['prod'])
  })

  it('prefers the longer overlapping name', () => {
    const segments = splitByTerms('Code review у нас такой', [REVIEW, term('code', 'code')])

    expect(segments[0]).toEqual({ kind: 'term', text: 'Code review', term: REVIEW })
  })

  it('ignores the difference between е and ё', () => {
    const ALERT = term('alert', 'Алёрт')

    expect(findTerms('Пришёл алерт', [ALERT])).toHaveLength(1)
  })

  it('keeps several different terms in text order', () => {
    const ids = findTerms('После ревью МР уезжает в прод', TERMS).map((m) => m.term.id)

    expect(ids).toEqual(['review', 'mr', 'prod'])
  })
})
