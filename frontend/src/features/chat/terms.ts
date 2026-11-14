import type { Term } from '@/entities/glossary'

/**
 * Подсветка терминов словаря в ответах бота (идея 30).
 * Ищем по границам слов без учёта регистра и «ё», подсвечиваем только первое вхождение термина.
 */
export type TextSegment =
  { kind: 'text'; text: string } | { kind: 'term'; text: string; term: Term }

type Match = { start: number; end: number; term: Term }

/** Та же длина строки, что у исходной: индексы совпадений годятся для исходного текста. */
const normalize = (value: string): string => value.toLowerCase().replaceAll('ё', 'е')

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char)

function findWord(haystack: string, needle: string): number {
  let from = 0
  while (needle !== '') {
    const index = haystack.indexOf(needle, from)
    if (index === -1) return -1
    const isBounded =
      !isWordChar(haystack[index - 1]) && !isWordChar(haystack[index + needle.length])
    if (isBounded) return index
    from = index + 1
  }
  return -1
}

/** Первое вхождение термина или любого синонима; при равном начале - самое длинное. */
function firstMatch(text: string, term: Term): Match | null {
  let best: Match | null = null
  for (const name of [term.term, ...term.synonyms]) {
    const needle = normalize(name.trim())
    const start = findWord(text, needle)
    if (start === -1) continue
    const end = start + needle.length
    if (!best || start < best.start || (start === best.start && end > best.end)) {
      best = { start, end, term }
    }
  }
  return best
}

/** Совпадения без пересечений, по порядку в тексте. */
export function findTerms(text: string, terms: readonly Term[]): Match[] {
  const normalized = normalize(text)
  const matches = terms
    .map((term) => firstMatch(normalized, term))
    .filter((m): m is Match => m !== null)
    .sort((a, b) => a.start - b.start || b.end - a.end)
  return matches.reduce<Match[]>((kept, match) => {
    const last = kept.at(-1)
    return last && match.start < last.end ? kept : [...kept, match]
  }, [])
}

/** Текст -> куски: обычный текст и термины. Без HTML, рендерим React-элементами. */
export function splitByTerms(text: string, terms: readonly Term[]): TextSegment[] {
  const segments: TextSegment[] = []
  let cursor = 0
  for (const match of findTerms(text, terms)) {
    if (match.start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, match.start) })
    segments.push({ kind: 'term', text: text.slice(match.start, match.end), term: match.term })
    cursor = match.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}
