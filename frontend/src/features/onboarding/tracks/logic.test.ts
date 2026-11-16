import { REQUIRED_TRACK_IDS, TRACKS, getTrack, type Track } from './catalog'
import {
  addTrack,
  applyQuizResult,
  buildRoute,
  canTakeQuiz,
  earnedBadges,
  ensureRequired,
  isStale,
  moveTrack,
  nextModule,
  removeTrack,
  scoreQuiz,
  setModuleStatus,
  trackProgress,
  type UserTracks,
} from './logic'
import { QUIZZES, getQuiz } from './quizzes'

const empty: UserTracks = { selected: [], modules: {} }
const mustTrack = (id: string): Track => {
  const track = getTrack(id)
  if (!track) throw new Error(id)
  return track
}

describe('выбор треков', () => {
  it('добавляет недостающие обязательные треки в начало', () => {
    const state = ensureRequired({ selected: ['kafka'], modules: {} }, REQUIRED_TRACK_IDS)
    expect(state.selected).toEqual([...REQUIRED_TRACK_IDS, 'kafka'])
  })

  it('не дублирует уже выбранный трек', () => {
    const state = addTrack(addTrack(empty, 'kafka'), 'kafka')
    expect(state.selected).toEqual(['kafka'])
  })

  it('не удаляет обязательный трек, но удаляет трек на выбор', () => {
    const state: UserTracks = { selected: ['access', 'kafka'], modules: {} }
    expect(removeTrack(state, 'access', REQUIRED_TRACK_IDS)).toBe(state)
    expect(removeTrack(state, 'kafka', REQUIRED_TRACK_IDS).selected).toEqual(['access'])
  })

  it('переносит трек на новую позицию и не мутирует исходник', () => {
    const state: UserTracks = { selected: ['a', 'b', 'c'], modules: {} }
    const moved = moveTrack(state, 'c', 0)
    expect(moved.selected).toEqual(['c', 'a', 'b'])
    expect(state.selected).toEqual(['a', 'b', 'c'])
  })

  it('ограничивает позицию краями списка', () => {
    const state: UserTracks = { selected: ['a', 'b'], modules: {} }
    expect(moveTrack(state, 'a', 10).selected).toEqual(['b', 'a'])
    expect(moveTrack(state, 'x', 0)).toBe(state)
  })
})

describe('тест «Я это знаю»', () => {
  const quiz = QUIZZES[0]
  const correct = quiz.questions.map((q) => q.correct)

  it('у каждого теста 5 вопросов и правильный ответ среди вариантов', () => {
    for (const item of QUIZZES) {
      expect(item.questions).toHaveLength(5)
      item.questions.forEach((q) => expect(q.correct).toBeLessThan(q.options.length))
    }
  })

  it('каждый quizId модуля ссылается на существующий тест', () => {
    const ids = TRACKS.flatMap((t) => t.modules)
      .map((m) => m.quizId)
      .filter((id): id is string => id !== null)
    ids.forEach((id) => expect(getQuiz(id)).toBeDefined())
  })

  it('считает верные ответы, пропуск не засчитывается', () => {
    expect(scoreQuiz(quiz, correct)).toBe(5)
    expect(scoreQuiz(quiz, [correct[0], null, null, null, null])).toBe(1)
  })

  it('4 из 5 закрывают модуль статусом skipped_by_test', () => {
    const state = applyQuizResult(empty, 'git-flow-1', 4, '2026-11-12')
    expect(state.modules['git-flow-1']).toEqual({
      status: 'skipped_by_test',
      lastScore: 4,
      lastAttempt: '2026-11-12',
    })
  })

  it('3 из 5 не закрывают модуль, пересдача только на следующий день', () => {
    const state = applyQuizResult(empty, 'git-flow-1', 3, '2026-11-12')
    expect(state.modules['git-flow-1'].status).toBe('todo')
    expect(canTakeQuiz(state, 'git-flow-1', '2026-11-12')).toBe(false)
    expect(canTakeQuiz(state, 'git-flow-1', '2026-11-13')).toBe(true)
  })

  it('закрытый модуль тест не открывает и пройденный модуль не понижает', () => {
    const done = setModuleStatus(empty, 'go-1', 'done')
    expect(canTakeQuiz(done, 'go-1')).toBe(false)
    expect(applyQuizResult(done, 'go-1', 5).modules['go-1'].status).toBe('done')
  })
})

describe('маршрут и бейджи', () => {
  const access = mustTrack('access')
  const kafka = mustTrack('kafka')

  it('прогресс трека учитывает и пройденные, и закрытые тестом модули', () => {
    const state = applyQuizResult(setModuleStatus(empty, 'kafka-2', 'done'), 'kafka-1', 5)
    expect(trackProgress(kafka, state)).toEqual({ done: 2, total: 2, isComplete: true })
  })

  it('недели считаются по накопленным минутам', () => {
    const route = buildRoute([access, kafka], empty, 2, 0.5)
    expect(route.map((step) => step.week)).toEqual([2, 4])
    expect(route[0].minutesLeft).toBe(30)
  })

  it('следующий шаг - первый открытый модуль в порядке треков', () => {
    const state = setModuleStatus(empty, 'access-1', 'done')
    expect(nextModule([access, kafka], state)?.module.id).toBe('access-2')
    expect(nextModule([], state)).toBeNull()
  })

  it('бейдж «Я это знаю» появляется после сдачи теста', () => {
    const before = earnedBadges([kafka], empty).find((b) => b.id === 'quiz')
    const after = earnedBadges([kafka], applyQuizResult(empty, 'kafka-1', 4)).find(
      (b) => b.id === 'quiz',
    )
    expect(before?.isEarned).toBe(false)
    expect(after?.isEarned).toBe(true)
  })

  it('документ старше 6 месяцев помечается как устаревший', () => {
    expect(isStale('2025-12-03', '2026-11-12')).toBe(true)
    expect(isStale('2026-10-12', '2026-11-12')).toBe(false)
  })
})
