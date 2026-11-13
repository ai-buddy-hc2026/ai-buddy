import {
  FIRST_DAY,
  buildReminder,
  readChecked,
  reminderSendAt,
  saveChecked,
  startPhase,
  toggleChecked,
} from './data'

describe('пребординг', () => {
  it('напоминание собирается из данных профиля', () => {
    const text = buildReminder(FIRST_DAY, 'Илья')
    expect(text).toBe(
      'Завтра к 10:00, вход с Лесной улицы, пропуск на ресепшене по паспорту, возьми паспорт, СНИЛС и ИНН для HR, телефон с Telegram для 2FA. Тебя встретит Илья',
    )
  })

  it('без обязательных вещей не пишет «возьми»', () => {
    const text = buildReminder({ ...FIRST_DAY, bring: [] }, 'Илья')
    expect(text).not.toContain('возьми')
  })

  it('крон отправляет напоминание накануне в 12:00', () => {
    expect(reminderSendAt('2026-11-02')).toBe('2026-11-01T12:00')
  })

  it('определяет фазу относительно «сегодня»', () => {
    expect(startPhase('2026-11-02', '2026-11-12')).toBe('past')
    expect(startPhase('2026-11-12', '2026-11-12')).toBe('today')
    expect(startPhase('2026-11-13', '2026-11-12')).toBe('tomorrow')
    expect(startPhase('2026-11-20', '2026-11-12')).toBe('soon')
  })

  it('отметки «что взять» переключаются и сохраняются', () => {
    const next = toggleChecked(toggleChecked([], 'passport'), 'snils')
    expect(next).toEqual(['passport', 'snils'])
    expect(toggleChecked(next, 'passport')).toEqual(['snils'])
    saveChecked(next)
    expect(readChecked()).toEqual(['passport', 'snils'])
  })

  it('битые отметки в хранилище дают пустой список', () => {
    localStorage.setItem('buddy.first-day.checked', '{"x":1}')
    expect(readChecked()).toEqual([])
  })
})
