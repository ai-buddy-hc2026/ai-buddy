import { tokenStore } from '@/shared/api/http'
import { DEMO_TODAY } from '@/shared/lib/date'
import { jsonResponse } from './fixtures.test-data'
import { remoteNotifications } from './notifications'
import { fromRemote, remoteSettings, toRemoteInput, type RemoteSettings } from './settings'

const remote: RemoteSettings = {
  theme: 'dark',
  lang: 'en',
  tone: 'detailed',
  workHours: { start: '09:00', end: '18:00', days: [1, 2], timezone: 'Asia/Yekaterinburg' },
  toggles: {
    briefing: false,
    hints: true,
    birthdayReminders: true,
    randomCoffee: false,
    showInterests: false,
  },
  notMyDayDate: '2026-11-16',
  telegramLinked: true,
  buddyEnabled: false,
}

function calls(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls as Array<[string, RequestInit]>
}

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('settings remote adapter', () => {
  test('fromRemote раскладывает пояс отдельно и помечает режим как сегодняшний', () => {
    const local = fromRemote(remote)
    expect(local.workHours).toEqual({ start: '09:00', end: '18:00', days: [1, 2] })
    expect(local.timezone).toBe('Asia/Yekaterinburg')
    expect(local.notMyDayDate).toBe(DEMO_TODAY)
    expect(local.buddyEnabled).toBe(false)
    expect(local.syncError).toBeNull()
  })

  test('fromRemote без режима даёт null', () => {
    expect(fromRemote({ ...remote, notMyDayDate: null }).notMyDayDate).toBeNull()
  })

  test('toRemoteInput собирает тело PATCH без вычисляемых полей', () => {
    const local = { ...fromRemote(remote), simulateFailure: false, simulateNight: false }
    const input = toRemoteInput(local as Parameters<typeof toRemoteInput>[0])
    expect(input).toEqual({
      theme: 'dark',
      lang: 'en',
      tone: 'detailed',
      workHours: remote.workHours,
      toggles: remote.toggles,
    })
  })

  test('save шлёт PATCH /settings и валидирует ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, remote))
    vi.stubGlobal('fetch', fetchMock)
    const saved = await remoteSettings.save(toRemoteInput({ ...fromRemote(remote) } as never))
    expect(saved.theme).toBe('dark')
    const [url, init] = calls(fetchMock)[0]!
    expect(url).toContain('/settings')
    expect(init.method).toBe('PATCH')
  })

  test('setDayMode шлёт POST /day-mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, remote))
    vi.stubGlobal('fetch', fetchMock)
    await remoteSettings.setDayMode(true)
    const [url, init] = calls(fetchMock)[0]!
    expect(url).toContain('/day-mode')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ enabled: true }))
  })

  test('setTelegram(false) шлёт DELETE', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { linked: false, code: null, deep_link: null }))
    vi.stubGlobal('fetch', fetchMock)
    const link = await remoteSettings.setTelegram(false)
    expect(link.linked).toBe(false)
    expect(calls(fetchMock)[0]![1].method).toBe('DELETE')
  })
})

describe('notifications remote adapter', () => {
  const item = {
    id: 'n1',
    feature: 'briefing',
    title: 'Доброе утро',
    body: '',
    deliver_at: '2026-11-16T07:00:00Z',
    read_at: null,
    created_at: '2026-11-16T06:00:00Z',
  }

  test('list с фильтром unread', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [item], unread_count: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const page = await remoteNotifications.list(true)
    expect(page.unread_count).toBe(1)
    expect(calls(fetchMock)[0]![0]).toContain('unread=true')
  })

  test('markRead шлёт POST на /notifications/{id}/read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...item, read_at: '2026-11-16T08:00:00Z' }))
    vi.stubGlobal('fetch', fetchMock)
    const read = await remoteNotifications.markRead('n1')
    expect(read.read_at).not.toBeNull()
    const [url, init] = calls(fetchMock)[0]!
    expect(url).toContain('/notifications/n1/read')
    expect(init.method).toBe('POST')
  })
})
