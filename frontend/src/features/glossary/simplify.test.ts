import { describe, expect, it } from 'vitest'
import { checkSimplicity, countWords, findBureaucratese, splitSentences } from './simplify'

describe('splitSentences', () => {
  it('splits by end punctuation and line breaks, drops empty parts', () => {
    // Arrange
    const text = 'Первое. Второе!\nТретье?  ...'

    // Act
    const sentences = splitSentences(text)

    // Assert
    expect(sentences).toEqual(['Первое.', 'Второе!', 'Третье?'])
  })
})

describe('countWords', () => {
  it('ignores standalone dashes', () => {
    expect(countWords('МР - это запрос на слияние')).toBe(5)
  })
})

describe('findBureaucratese', () => {
  it('finds phrases case-insensitively as whole words', () => {
    // Arrange
    const text = 'В рамках релиза ДАННЫЙ сервис обновим'

    // Act
    const found = findBureaucratese(text)

    // Assert
    expect(found).toEqual(['в рамках', 'данный'])
  })

  it('does not match a phrase inside another word', () => {
    expect(findBureaucratese('Это дополнительный шаг', ['данный'])).toEqual([])
  })
})

describe('checkSimplicity', () => {
  it('marks short plain text as simple', () => {
    // Arrange
    const text = 'МР - запрос на слияние кода. Его смотрит ревьюер.'

    // Act
    const report = checkSimplicity(text)

    // Assert
    expect(report.isSimple).toBe(true)
    expect(report.sentenceCount).toBe(2)
    expect(report.avgWords).toBe(4)
  })

  it('reports long sentences over the word limit', () => {
    // Arrange
    const long = Array.from({ length: 12 }, (_, i) => `слово${i}`).join(' ') + '.'

    // Act
    const report = checkSimplicity(`Коротко. ${long}`, 10)

    // Assert
    expect(report.isSimple).toBe(false)
    expect(report.longSentences).toEqual([long])
  })

  it('reports bureaucratese even when sentences are short', () => {
    const report = checkSimplicity('Таким образом, деплой осуществляется ночью.')

    expect(report.isSimple).toBe(false)
    expect(report.bureaucratese).toEqual(['осуществляется', 'таким образом'])
  })

  it('handles empty text', () => {
    const report = checkSimplicity('   ')

    expect(report).toEqual({
      sentenceCount: 0,
      avgWords: 0,
      longSentences: [],
      bureaucratese: [],
      isSimple: true,
    })
  })
})
