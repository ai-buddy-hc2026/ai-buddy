import { ApiError } from '@/shared/api/http'
import { remoteCalendar, toLocalStart } from './calendar'
import { ANYA_ID, jsonResponse } from './fixtures.test-data'

const SLOT_ID = '30000000-0000-0000-0000-000000000001'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('remote calendar', () => {
  test('слоты из API приводятся к модели фронта', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        host: { code: 'ilya' },
        items: [{ id: SLOT_ID, host_code: 'ilya', starts_at: '2026-11-17T12:00:00Z', minutes: 30 }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const slots = await remoteCalendar.officeHours('ilya')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/calendar/ilya/office-hours')
    expect(slots).toEqual([
      {
        id: SLOT_ID,
        employeeId: 'ilya',
        start: toLocalStart('2026-11-17T12:00:00Z'),
        minutes: 30,
        bookedBy: null,
        topic: '',
      },
    ])
  })

  test('бронь отправляет slot_id и тему, бронирующий - карточка фронта', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(201, {
        id: 'BOOK-0001',
        slot_id: SLOT_ID,
        host_code: 'ilya',
        attendee_id: ANYA_ID,
        starts_at: '2026-11-17T12:00:00Z',
        topic: '1:1',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const booking = await remoteCalendar.book(SLOT_ID, '1:1')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ slot_id: SLOT_ID, topic: '1:1' })
    expect(booking.attendeeId).toBe('anya')
    expect(booking.id).toBe('BOOK-0001')
  })

  test('занятый слот - ApiError 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(409, { error: { code: 'CONFLICT', message: 'Уже занято' } }),
        ),
    )

    await expect(remoteCalendar.book(SLOT_ID, '')).rejects.toMatchObject({
      status: 409,
      constructor: ApiError,
    })
  })
})
