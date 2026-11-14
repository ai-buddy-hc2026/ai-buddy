import { EMPLOYEES, mustEmployee, type Employee } from '@/entities/employees'
import {
  addInterest,
  bookingDraft,
  interestMatches,
  keyPeople,
  makePairs,
  matchedTag,
  messageDraft,
  nextOccurrence,
  normalizeInterest,
  pairKey,
  pairsOf,
  proposeTimes,
  removeInterest,
  sortSlots,
  toTab,
  upcomingBirthdays,
  weekOf,
} from './logic'

const anya = mustEmployee('anya')
const TODAY = '2026-11-12'

const person = (id: string, teamId: string): Pick<Employee, 'id' | 'teamId'> => ({ id, teamId })

describe('toTab', () => {
  it('возвращает известную вкладку', () => {
    expect(toTab('coffee')).toBe('coffee')
  })

  it('неизвестную или пустую вкладку превращает в team', () => {
    expect(toTab('nope')).toBe('team')
    expect(toTab(undefined)).toBe('team')
  })
})

describe('keyPeople', () => {
  it('показывает команду и HR без самого стажёра, наставник первым', () => {
    // Act
    const people = keyPeople(EMPLOYEES, anya)
    // Assert
    expect(people[0].id).toBe('ilya')
    expect(people.map((p) => p.id)).toContain('dasha')
    expect(people.map((p) => p.id)).not.toContain('anya')
    expect(people.map((p) => p.id)).not.toContain('dima')
  })
})

describe('matchedTag и messageDraft', () => {
  it('находит тег зоны ответственности в вопросе', () => {
    expect(matchedTag('Кто отвечает за мониторинг?', mustEmployee('oleg'))).toBe('мониторинг')
  })

  it('возвращает null, если тега нет', () => {
    expect(matchedTag('Где столовая?', mustEmployee('oleg'))).toBeNull()
  })

  it('собирает черновик с вопросом и без него', () => {
    const oleg = mustEmployee('oleg')
    expect(messageDraft(oleg, ' как задеплоить? ')).toBe(
      'Привет, Олег! Подскажи, пожалуйста: как задеплоить?',
    )
    expect(messageDraft(oleg, '')).toBe('Привет, Олег! Можно вопрос?')
  })
})

describe('дни рождения', () => {
  it('ближайшая дата в этом году, если ещё не прошла', () => {
    expect(nextOccurrence('11-20', TODAY)).toBe('2026-11-20')
  })

  it('прошедший ДР переносит на следующий год', () => {
    expect(nextOccurrence('03-21', TODAY)).toBe('2027-03-21')
  })

  it('показывает только свою команду, без скрытых и без себя, по близости', () => {
    // Act
    const list = upcomingBirthdays(EMPLOYEES, anya, TODAY)
    // Assert
    expect(list.map((b) => b.employee.id)).toEqual(['sveta', 'oleg'])
    expect(list[0].inDays).toBe(0)
    expect(list[1].inDays).toBe(8)
  })

  it('уважает окно в днях', () => {
    expect(upcomingBirthdays(EMPLOYEES, anya, TODAY, 3).map((b) => b.employee.id)).toEqual([
      'sveta',
    ])
  })
})

describe('bookingDraft', () => {
  it('готовит запись брони с ключом идемпотентности', () => {
    // Act
    const draft = bookingDraft(
      { id: 's-ilya-2', start: '2026-11-19T11:00' },
      mustEmployee('ilya'),
      'anya',
      '1:1',
      'чт, 19.11 в 11:00',
    )
    // Assert
    expect(draft.kind).toBe('booking')
    expect(draft.status).toBe('sent')
    expect(draft.idempotencyKey).toBe('booking-s-ilya-2-anya')
    expect(draft.details).toEqual([
      { label: 'Когда', value: 'чт, 19.11 в 11:00' },
      { label: 'Тема', value: '1:1' },
    ])
  })

  it('сортирует слоты по времени и не трогает исходный массив', () => {
    const slots = [{ start: '2026-11-19T11:00' }, { start: '2026-11-17T15:00' }]
    expect(sortSlots(slots).map((x) => x.start)).toEqual(['2026-11-17T15:00', '2026-11-19T11:00'])
    expect(slots[0].start).toBe('2026-11-19T11:00')
  })
})

describe('random coffee', () => {
  it('weekOf возвращает понедельник', () => {
    expect(weekOf(TODAY)).toBe('2026-11-09')
    expect(weekOf('2026-11-09')).toBe('2026-11-09')
    expect(weekOf('2026-11-15')).toBe('2026-11-09')
  })

  it('pairKey не зависит от порядка, pairsOf раскладывает тройку на три пары', () => {
    expect(pairKey(['lena', 'anya'])).toBe('anya+lena')
    expect(pairsOf(['a', 'b', 'c'])).toEqual(['a+b', 'a+c', 'b+c'])
  })

  it('составляет пары только из разных команд, когда это возможно', () => {
    // Arrange
    const people = [person('a1', 'A'), person('a2', 'A'), person('b1', 'B'), person('b2', 'B')]
    // Act
    const groups = makePairs(people, [], '2026-11-09')
    // Assert
    expect(groups).toHaveLength(2)
    groups.forEach((group) => {
      const teams = group.map((id) => people.find((p) => p.id === id)?.teamId)
      expect(new Set(teams).size).toBe(2)
    })
  })

  it('не повторяет пары прошлых недель', () => {
    // Arrange
    const people = [person('a1', 'A'), person('b1', 'B'), person('c1', 'C'), person('d1', 'D')]
    const first = makePairs(people, [], 'w1')
    const history = first.flatMap(pairsOf)
    // Act
    const second = makePairs(people, history, 'w1')
    // Assert
    second.flatMap(pairsOf).forEach((key) => expect(history).not.toContain(key))
  })

  it('при нечётном числе делает одну тройку и никого не теряет', () => {
    // Arrange
    const people = [
      person('a', 'A'),
      person('b', 'B'),
      person('c', 'C'),
      person('d', 'D'),
      person('e', 'E'),
    ]
    // Act
    const groups = makePairs(people, [], 'w')
    // Assert
    expect(groups.map((g) => g.length).sort()).toEqual([2, 3])
    expect(groups.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('одному участнику пару не составляет', () => {
    expect(makePairs([person('a', 'A')], [], 'w')).toEqual([])
  })

  it('одинаковый seed даёт одинаковые пары', () => {
    const people = [person('a', 'A'), person('b', 'B'), person('c', 'C'), person('d', 'D')]
    expect(makePairs(people, [], 'w7')).toEqual(makePairs(people, [], 'w7'))
  })

  it('предлагает время на ближайшие рабочие дни внутри общих часов', () => {
    // Act: четверг -> пятница, понедельник, вторник
    const times = proposeTimes(TODAY, [
      { start: '10:00', end: '19:00' },
      { start: '10:00', end: '19:00' },
    ])
    // Assert
    expect(times).toEqual(['2026-11-13T15:00', '2026-11-16T12:30', '2026-11-17T16:30'])
  })

  it('сдвигает время к началу общего окна, если любимое не помещается', () => {
    const times = proposeTimes(TODAY, [{ start: '16:00', end: '17:00' }], 1)
    expect(times).toEqual(['2026-11-13T16:00'])
  })

  it('без общего окна времени не предлагает', () => {
    expect(
      proposeTimes(TODAY, [
        { start: '10:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ]),
    ).toEqual([])
  })
})

describe('увлечения', () => {
  const known = ['бег', 'настолки', 'футбол']

  it('приводит разговорный ввод к существующему тегу', () => {
    expect(normalizeInterest('Футбик', known)).toBe('футбол')
    expect(normalizeInterest('  настольные   игры ', known)).toBe('настолки')
    expect(normalizeInterest('футб', known)).toBe('футбол')
  })

  it('новое увлечение оставляет как есть, пустое - пустым', () => {
    expect(normalizeInterest('Шахматы', known)).toBe('шахматы')
    expect(normalizeInterest('   ', known)).toBe('')
  })

  it('добавляет без дублей и убирает без мутации', () => {
    const list = ['бег']
    expect(addInterest(list, 'бег')).toEqual(['бег'])
    expect(addInterest(list, 'футбол')).toEqual(['бег', 'футбол'])
    expect(removeInterest(list, 'бег')).toEqual([])
    expect(list).toEqual(['бег'])
  })

  it('находит людей с общими увлечениями, больше общих - выше, себя нет', () => {
    // Act
    const matches = interestMatches(['футбол', 'настолки'], EMPLOYEES, 'anya')
    // Assert
    expect(matches.map((m) => m.employee.id)).not.toContain('anya')
    expect(matches[0].shared.length).toBeGreaterThanOrEqual(
      matches[matches.length - 1].shared.length,
    )
    expect(matches.find((m) => m.employee.id === 'oleg')?.shared).toEqual(['футбол'])
    expect(matches.find((m) => m.employee.id === 'maria')).toBeUndefined()
  })
})
