import { getEmployee, type Employee } from '@/entities/employees'
import { BUDDY_ID, GROUP_ID, SEED_THREADS, contactsOf, listThreads, matchContact } from './threads'

function employee(id: string): Employee {
  const found = getEmployee(id)
  if (!found) throw new Error(`no fixture ${id}`)
  return found
}

describe('список чатов', () => {
  test('стажёр по умолчанию видит buddy, группу стажёров и наставника', () => {
    const ids = listThreads(employee('anya')).map((th) => th.id)
    expect(ids).toEqual([BUDDY_ID, GROUP_ID, 'ilya'])
  })

  test('второй стажёр команды получает того же наставника', () => {
    const ids = listThreads(employee('kostya')).map((th) => th.id)
    expect(ids).toEqual([BUDDY_ID, GROUP_ID, 'ilya'])
  })

  test('начатые чаты добавляются без дублей, себя и неизвестных id нет', () => {
    const ids = listThreads(employee('anya'), ['oleg', 'ilya', 'anya', 'nobody', GROUP_ID]).map(
      (th) => th.id,
    )
    expect(ids).toEqual([BUDDY_ID, GROUP_ID, 'ilya', 'oleg'])
  })

  test('у наставника нет группы стажёров и закреплённого наставника', () => {
    const ids = listThreads(employee('ilya')).map((th) => th.id)
    expect(ids).toEqual([BUDDY_ID])
  })

  test('тестовых переписок нет, в группе только правила', () => {
    expect(Object.keys(SEED_THREADS).sort()).toEqual([BUDDY_ID, GROUP_ID].sort())
    expect(SEED_THREADS[GROUP_ID].map((m) => m.from)).toEqual(['bot'])
  })
})

describe('новый чат через «+»', () => {
  test('в контактах все сотрудники, кроме себя', () => {
    const contacts = contactsOf(employee('anya'))
    expect(contacts.some((e) => e.id === 'anya')).toBe(false)
    expect(contacts.map((e) => e.id)).toEqual(expect.arrayContaining(['ilya', 'oleg', 'kostya']))
  })

  test('поиск по имени, роли и команде без учёта регистра', () => {
    const oleg = employee('oleg')
    expect(matchContact(oleg, 'ОЛЕГ')).toBe(true)
    expect(matchContact(oleg, 'devops')).toBe(true)
    expect(matchContact(oleg, 'объявлений')).toBe(true)
    expect(matchContact(oleg, 'аналитик')).toBe(false)
    expect(matchContact(oleg, '   ')).toBe(true)
  })
})
