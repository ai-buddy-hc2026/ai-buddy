import { tokenStore } from '@/shared/api/http'
import { ANYA_ID, jsonResponse } from './fixtures.test-data'
import {
  remoteBrag,
  remoteEvents,
  remoteFeedback,
  toFeedbackRequest,
  toLocalDate,
  toLocalMinute,
  type ApiFeedback,
} from './growthRemote'

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const OTHER_ID = '4a59a828-3b1a-55e4-bf9b-81db5ad6183a'

function feedback(overrides: Partial<ApiFeedback> = {}): ApiFeedback {
  return {
    id: 'f1',
    fromId: ANYA_ID,
    toId: OTHER_ID,
    artifactUrl: 'https://gitlab.test/1',
    artifactTitle: 'MR',
    question: 'Что улучшить?',
    status: 'answered',
    answer: 'Добавь тесты',
    sentAt: '2026-11-10T07:00:00Z',
    expiresAt: '2026-11-17T07:00:00Z',
    answeredAt: '2026-11-11T07:00:00Z',
    savedToBrag: false,
    externalId: null,
    ...overrides,
  }
}

describe('growth remote adapters', () => {
  it('formats server time as local minute without zone', () => {
    const local = new Date(2026, 10, 13, 12, 5)
    expect(toLocalMinute(local.toISOString())).toBe('2026-11-13T12:05')
    expect(toLocalDate(local.toISOString())).toBe('2026-11-13')
    expect(toLocalMinute('not a date')).toBe('not a date')
  })

  it('maps feedback to day-precision model without server-only fields', () => {
    const mapped = toFeedbackRequest(feedback())
    expect(mapped.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(mapped).not.toHaveProperty('fromId')
    expect(mapped).not.toHaveProperty('expiresAt')
  })

  it('keeps only requests the viewer sent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, {
          items: [feedback(), feedback({ id: 'f2', fromId: OTHER_ID, toId: ANYA_ID })],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const list = await remoteFeedback.listSent(ANYA_ID)
    expect(list.map((item) => item.id)).toEqual(['f1'])
  })

  it('removes brag entries with DELETE and accepts 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(remoteBrag.remove('b 1')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/growth/brag/b%201')
    expect(init.method).toBe('DELETE')
  })

  it('converts event start to local time', async () => {
    const start = new Date(2026, 10, 18, 12, 0)
    const event = {
      id: 'e1',
      kind: 'training',
      title: 'Деплой',
      description: '',
      start: start.toISOString(),
      minutes: 60,
      placeId: null,
      placeName: 'Онлайн',
      hostId: OTHER_ID,
      tags: [],
      capacity: 10,
      attendees: [],
      materials: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { items: [event] })))
    const [first] = await remoteEvents.list()
    expect(first?.start).toBe('2026-11-18T12:00')
  })
})
