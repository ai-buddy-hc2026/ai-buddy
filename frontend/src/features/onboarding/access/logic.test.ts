import { accessApi, templateFor } from './data'
import {
  addRequest,
  countByStatus,
  hasAutoPending,
  isStuck,
  missingOf,
  resolveAccess,
  roleKey,
  type AccessDef,
  type AccessState,
} from './logic'

const grafana: AccessDef = {
  id: 'grafana',
  title: 'Grafana',
  about: '',
  approverId: 'oleg',
  grantAfterSec: 5,
}
const k8s: AccessDef = {
  id: 'k8s-dev',
  title: 'k8s-dev',
  about: '',
  approverId: 'oleg',
  grantAfterSec: null,
}
const jira: AccessDef = {
  id: 'jira',
  title: 'Jira',
  about: '',
  approverId: 'maria',
  grantAfterSec: 15,
}
const template = [grafana, k8s, jira]
const created = '2026-11-12T10:00:00.000Z'
const createdMs = new Date(created).getTime()

describe('пакет доступов', () => {
  it('недостающие = шаблон роли минус выданные и запрошенные', () => {
    const state: AccessState = {
      granted: ['grafana'],
      requests: [
        {
          id: 'r1',
          externalId: 'ACC-1041',
          createdAt: created,
          items: [{ accessId: 'k8s-dev', grantAfterSec: null }],
        },
      ],
    }
    const items = resolveAccess(state, template, createdMs, '2026-11-12')
    expect(missingOf(items).map((a) => a.id)).toEqual(['jira'])
    expect(countByStatus(items)).toEqual({ granted: 1, pending: 1, missing: 1 })
  })

  it('одна заявка на все выбранные пункты и без мутаций', () => {
    const state: AccessState = { granted: [], requests: [] }
    const next = addRequest(state, [grafana, jira], {
      id: 'r2',
      externalId: 'ACC-1042',
      createdAt: created,
    })
    expect(next.requests).toHaveLength(1)
    expect(next.requests[0].items.map((i) => i.accessId)).toEqual(['grafana', 'jira'])
    expect(state.requests).toHaveLength(0)
    expect(addRequest(state, [], { id: 'r3', externalId: 'x', createdAt: created })).toBe(state)
  })

  it('мок выдаёт доступ по таймеру: на согласовании -> выдан', () => {
    const state = addRequest({ granted: [], requests: [] }, [grafana, jira], {
      id: 'r',
      externalId: 'ACC-1042',
      createdAt: created,
    })
    const early = resolveAccess(state, template, createdMs + 1000)
    const later = resolveAccess(state, template, createdMs + 6000)
    expect(early.find((i) => i.access.id === 'grafana')?.status).toBe('pending')
    expect(later.find((i) => i.access.id === 'grafana')?.status).toBe('granted')
    expect(later.find((i) => i.access.id === 'jira')?.requestId).toBe('ACC-1042')
    expect(hasAutoPending(later)).toBe(true)
  })

  it('заявка без ручного согласования дольше 2 дней - блокер', () => {
    const state: AccessState = {
      granted: [],
      requests: [
        {
          id: 'r1',
          externalId: 'ACC-1041',
          createdAt: '2026-11-10T11:00:00',
          items: [{ accessId: 'k8s-dev', grantAfterSec: null }],
        },
      ],
    }
    const item = resolveAccess(state, [k8s], Date.now(), '2026-11-12')[0]
    expect(item.pendingDays).toBe(2)
    expect(isStuck(item)).toBe(true)
    expect(hasAutoPending([item])).toBe(false)
  })

  it('выбирает шаблон по должности', () => {
    expect(roleKey('Стажёр Backend')).toBe('backend')
    expect(roleKey('Стажёр Frontend')).toBe('frontend')
    expect(templateFor('frontend').length).toBeGreaterThan(0)
  })

  it('мок сохраняет заявку и показывает её в статусах', async () => {
    await accessApi.createRequest([templateFor('backend')[3]], 'ACC-1042')
    const items = await accessApi.list('backend')
    expect(items.find((i) => i.access.id === 'jira')?.status).toBe('pending')
    expect(items.find((i) => i.access.id === 'gitlab')?.status).toBe('granted')
  })
})
