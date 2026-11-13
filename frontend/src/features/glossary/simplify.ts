/**
 * Проверка простоты текста (идея 31): короткие предложения и без канцелярита.
 * Та же проверка подходит для ответов бота на тестовые вопросы.
 */

/** Предложение длиннее этого числа слов считаем длинным. */
export const MAX_SENTENCE_WORDS = 20

/** Канцелярит и ИИ-обороты, которых не должно быть в ответах buddy. */
export const BUREAUCRATESE: readonly string[] = [
  'в рамках',
  'данный',
  'данная',
  'данное',
  'данные процессы',
  'осуществлять',
  'осуществляется',
  'является',
  'являются',
  'в целях',
  'посредством',
  'таким образом',
  'важно отметить',
  'следует отметить',
  'давайте рассмотрим',
  'в связи с',
  'надлежащим образом',
  'вышеуказанный',
  'производится',
  'на сегодняшний день',
  'имеет место',
  'в соответствии с',
]

export interface SimplicityReport {
  sentenceCount: number
  /** Средняя длина предложения в словах, округлена до десятых */
  avgWords: number
  longSentences: string[]
  /** Найденные обороты из списка, без повторов, в порядке списка */
  bureaucratese: string[]
  isSimple: boolean
}

const LETTER = '\\p{L}'

function normalize(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е')
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part))
}

export function countWords(sentence: string): number {
  return sentence.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Обороты из списка, которые встречаются в тексте целыми словами. */
export function findBureaucratese(
  text: string,
  phrases: readonly string[] = BUREAUCRATESE,
): string[] {
  const haystack = normalize(text)
  return phrases.filter((phrase) => {
    const pattern = new RegExp(`(?<!${LETTER})${escapeRegExp(normalize(phrase))}(?!${LETTER})`, 'u')
    return pattern.test(haystack)
  })
}

export function checkSimplicity(
  text: string,
  maxWords: number = MAX_SENTENCE_WORDS,
): SimplicityReport {
  const sentences = splitSentences(text)
  const lengths = sentences.map(countWords)
  const total = lengths.reduce((sum, n) => sum + n, 0)
  const longSentences = sentences.filter((_, i) => lengths[i] > maxWords)
  const bureaucratese = findBureaucratese(text)
  return {
    sentenceCount: sentences.length,
    avgWords: sentences.length === 0 ? 0 : Math.round((total / sentences.length) * 10) / 10,
    longSentences,
    bureaucratese,
    isSimple: longSentences.length === 0 && bureaucratese.length === 0,
  }
}
