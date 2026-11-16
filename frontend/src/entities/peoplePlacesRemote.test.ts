import { describe, expect, it } from 'vitest'
import { EMPLOYEES, loadEmployees, mustEmployee, toEmployee } from './employees'
import { PLACES, loadPlaces, toPlace } from './places'

const apiEmployee = {
  code: 'oleg',
  team_id: '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2',
  name: 'Олег Деплоев',
  title: 'DevOps',
  kind: 'colleague' as const,
  tags: ['деплой'],
  ask_about: 'Деплой',
  birthday: '11-20',
  desk_id: 'desk-oleg',
}

describe('employees remote adapter', () => {
  it('берёт справочные поля из API, а оформление из фикстуры с тем же кодом', () => {
    const employee = toEmployee(apiEmployee, 0)
    const fixture = mustEmployee('oleg')

    expect(employee).toMatchObject({ id: 'oleg', role: 'DevOps', tags: ['деплой'] })
    expect(employee.color).toBe(fixture.color)
    expect(employee.teamId).toBe(fixture.teamId)
  })

  it('незнакомому сотруднику даёт значения по умолчанию', () => {
    const employee = toEmployee(
      { ...apiEmployee, code: 'newbie', name: 'Новый Коллега', tags: null },
      1,
    )

    expect(employee).toMatchObject({ id: 'newbie', short: 'Новый', tags: [], interests: [] })
    expect(employee.teamId).toBe(apiEmployee.team_id)
  })

  it('в мок-режиме отдаёт фикстуры', async () => {
    await expect(loadEmployees()).resolves.toBe(EMPLOYEES)
  })
})

describe('places remote adapter', () => {
  it('переводит kind и employee_code в модель фронта', () => {
    const place = toPlace({
      id: 'desk-anya',
      floor: 3,
      kind: 'desk',
      name: 'Стол Ани',
      aliases: null,
      x: 1,
      y: 2,
      w: 1,
      d: 1,
      employee_code: 'anya',
      node_id: 'n-ads',
    })

    expect(place).toMatchObject({ type: 'desk', employeeId: 'anya', aliases: [], nodeId: 'n-ads' })
  })

  it('в мок-режиме отдаёт фикстуры', async () => {
    await expect(loadPlaces()).resolves.toBe(PLACES)
  })
})
