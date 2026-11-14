import { isValidHours, isValidTime, toggleDay } from './logic'

describe('toggleDay', () => {
  it('добавляет день и держит порядок', () => {
    expect(toggleDay([1, 5], 3)).toEqual([1, 3, 5])
  })

  it('убирает день, не меняя исходный массив', () => {
    // Arrange
    const days = [1, 2, 3]
    // Act
    const next = toggleDay(days, 2)
    // Assert
    expect(next).toEqual([1, 3])
    expect(days).toEqual([1, 2, 3])
  })

  it('не даёт выключить последний рабочий день', () => {
    expect(toggleDay([4], 4)).toEqual([4])
  })
})

describe('isValidHours', () => {
  it('принимает окно, где начало раньше конца', () => {
    expect(isValidHours({ start: '10:00', end: '19:00' })).toBe(true)
  })

  it('отклоняет перевёрнутое окно и битое время', () => {
    expect(isValidHours({ start: '19:00', end: '10:00' })).toBe(false)
    expect(isValidTime('25:00')).toBe(false)
    expect(isValidTime('')).toBe(false)
  })
})
