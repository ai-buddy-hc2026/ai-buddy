import type { Task } from '@/entities/plan'
import {
  addAgreement,
  agreementsToTasks,
  extractMeeting,
  extractWithRetry,
  finalizeDraft,
  parseDue,
  removeAgreement,
  updateAgreement,
  type Agreement,
  type Person,
} from './meetingNotesLogic'

const TODAY = '2026-11-12' // чт
const PEOPLE: Person[] = [
  { short: 'Илья', role: 'mentor' },
  { short: 'Олег', role: 'other' },
  { short: 'Лена', role: 'other' },
]

describe('parseDue', () => {
  it('понимает дни недели, относительные слова и даты', () => {
    expect(parseDue('до среды', TODAY)?.date).toBe('2026-11-18')
    expect(parseDue('в четверг', TODAY)?.date).toBe('2026-11-19')
    expect(parseDue('завтра', TODAY)?.date).toBe('2026-11-13')
    expect(parseDue('послезавтра', TODAY)?.date).toBe('2026-11-14')
    expect(parseDue('до 18.11', TODAY)?.date).toBe('2026-11-18')
    expect(parseDue('через 3 дня', TODAY)?.date).toBe('2026-11-15')
    expect(parseDue('до конца недели', TODAY)?.date).toBe('2026-11-13')
  })

  it('без срока возвращает null, кривую дату не принимает', () => {
    expect(parseDue('прочитать гайд', TODAY)).toBeNull()
    expect(parseDue('до 31.02', TODAY)).toBeNull()
  })
})

describe('extractMeeting', () => {
  it('разбирает пример из идеи: две договорённости с владельцами и сроком', () => {
    // Arrange
    const text = 'Илья выдаст доступ к k8s до среды, ты читаешь гайд по тестам'
    // Act
    const draft = extractMeeting(text, PEOPLE, TODAY)
    // Assert
    expect(draft.agreements.map((a) => [a.owner, a.what, a.due_date])).toEqual([
      ['mentor', 'Илья выдаст доступ к k8s', '2026-11-18'],
      ['intern', 'Ты читаешь гайд по тестам', null],
    ])
    expect(draft.summary).toContain('Договорились')
  })

  it('обсуждение уходит в саммари, коллега получает owner = other', () => {
    const text = [
      'Обсудили первую задачу и ревью.',
      '- Олег пришлёт пример конфига завтра',
      '- я поправлю тесты в MR !421',
    ].join('\n')
    const draft = extractMeeting(text, PEOPLE, TODAY)
    expect(draft.summary).toBe('Обсудили первую задачу и ревью')
    expect(draft.agreements.map((a) => [a.owner, a.due_date])).toEqual([
      ['other', '2026-11-13'],
      ['intern', null],
    ])
  })

  it('без договорённостей остаётся только саммари', () => {
    const draft = extractMeeting('Обсудили, как прошла неделя. Всё спокойно', PEOPLE, TODAY)
    expect(draft.agreements).toEqual([])
    expect(draft.summary).toContain('Обсудили')
  })

  it('слово «лень» не путает с Леной', () => {
    const draft = extractMeeting('мне лень, но надо настроить линтер', PEOPLE, TODAY)
    expect(draft.agreements[0].owner).toBe('intern')
  })

  it('пустой текст даёт пустой черновик, который не проходит схему', () => {
    const result = extractWithRetry(() => extractMeeting('   ', PEOPLE, TODAY))
    expect(result.ok).toBe(false)
  })
})

describe('extractWithRetry', () => {
  it('делает один повтор, если первый ответ не прошёл схему', () => {
    // Arrange
    const run = vi
      .fn()
      .mockReturnValueOnce({ summary: 1 })
      .mockReturnValueOnce({ summary: 'Итоги', agreements: [] })
    // Act
    const result = extractWithRetry(run)
    // Assert
    expect(result).toEqual({ ok: true, draft: { summary: 'Итоги', agreements: [] } })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('после второй неудачи возвращает ошибку', () => {
    const run = vi.fn().mockReturnValue({ nope: true })
    expect(extractWithRetry(run)).toEqual({ ok: false })
    expect(run).toHaveBeenCalledTimes(2)
  })
})

const ag = (patch: Partial<Agreement>): Agreement => ({
  id: 'a1',
  owner: 'intern',
  what: 'Прочитать гайд',
  due_date: null,
  ...patch,
})

describe('правка черновика', () => {
  it('меняет, удаляет и добавляет пункты без мутаций', () => {
    const list = [ag({}), ag({ id: 'a2', what: 'Второй' })]
    expect(updateAgreement(list, 'a1', { owner: 'mentor' })[0].owner).toBe('mentor')
    expect(list[0].owner).toBe('intern')
    expect(removeAgreement(list, 'a1').map((a) => a.id)).toEqual(['a2'])
    expect(addAgreement(list, 'a3')).toHaveLength(3)
  })

  it('finalizeDraft выкидывает пустые пункты и требует саммари', () => {
    const draft = { summary: ' Итоги ', agreements: [ag({}), ag({ id: 'x', what: '  ' })] }
    expect(finalizeDraft(draft)?.agreements.map((a) => a.id)).toEqual(['a1'])
    expect(finalizeDraft({ summary: ' ', agreements: [] })).toBeNull()
  })
})

describe('agreementsToTasks', () => {
  it('делает задачи с source = meeting:<id> и не дублирует уже добавленные', () => {
    // Arrange
    const existing = [
      { title: 'Прочитать гайд', source: 'meeting:s-ilya-0' } as Task,
      { title: 'Прочитать гайд', source: 'checklist' } as Task,
    ]
    const agreements = [
      ag({}),
      ag({ id: 'a2', owner: 'mentor', what: 'Выдать доступ', due_date: '2026-11-18' }),
      ag({ id: 'a3', owner: 'other', what: 'Олег пришлёт конфиг' }),
    ]
    // Act
    const tasks = agreementsToTasks(agreements, 's-ilya-0', existing)
    // Assert
    expect(tasks.map((t) => [t.title, t.owner, t.due, t.source])).toEqual([
      ['Выдать доступ', 'mentor', '2026-11-18', 'meeting:s-ilya-0'],
      ['Олег пришлёт конфиг', 'intern', null, 'meeting:s-ilya-0'],
    ])
    expect(tasks[0].note).toBe('Обязательство наставника')
  })
})
