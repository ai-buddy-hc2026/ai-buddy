import { ApiError, tokenStore } from '@/shared/api/http'
import {
  calendarBookingSchema,
  clearCalendarDraft,
  formatCalendarTime,
  prepareCalendarDraft,
  readCalendarDraft,
  remoteCalendar,
} from './remote-calendar'
import { useSession } from './session'

const userId = 'a24a3478-cf42-51b1-b05b-9833260247a5'
const slotId = '30000000-0000-4000-8000-000000000001'
const booking = {
  id: '50000000-0000-4000-8000-000000000001',
  slot_id: slotId,
  employee_id: '10000000-0000-0000-0000-000000000003',
  attendee_id: userId,
  host_name: 'Мария',
  attendee_name: 'Аня',
  starts_at: '2030-01-01T12:00:00Z',
  ends_at: '2030-01-01T12:30:00Z',
  timezone: 'Europe/Moscow',
  topic: '1:1',
  status: 'confirmed',
  confirmed_at: '2029-12-31T00:00:00Z',
}
beforeEach(() => {
  localStorage.clear()
  useSession.setState({
    remote: { id: userId, login: 'intern_anya', name: 'Аня', role: 'intern', teamName: 'Команда' },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
  localStorage.clear()
  useSession.setState({ remote: null })
})

test('повтор после неопределённого результата сохраняет ключ и тему, включая перезагрузку', () => {
  const original = prepareCalendarDraft(userId, slotId, ' 1:1 ')
  expect(readCalendarDraft(userId, slotId)).toEqual(original)
  expect(prepareCalendarDraft(userId, slotId, '1:1')).toEqual(original)
  expect(() => prepareCalendarDraft(userId, slotId, 'Другая тема')).toThrow()
  expect(readCalendarDraft('2db7cc77-4114-52d8-a833-f670ab60e4e0', slotId)).toBeNull()
  clearCalendarDraft(userId, slotId)
  expect(readCalendarDraft(userId, slotId)).toBeNull()
})

test('подтверждение передаёт устойчивый ключ и не принимает участника из браузера', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(booking)))
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set('test-token')
  const draft = prepareCalendarDraft(userId, slotId, '1:1')
  const result = await remoteCalendar.book(userId, draft)
  expect(result.id).toBe(booking.id)
  const [, options] = fetchMock.mock.calls[0]
  expect(options.headers['Idempotency-Key']).toBe(draft.idempotency_key)
  expect(JSON.parse(options.body)).toEqual({ slot_id: slotId, topic: '1:1', confirmed: true })
  expect(options.headers.Authorization).toBe('Bearer test-token')
})

test('смена пользователя блокирует отправку старого подтверждения', () => {
  const draft = prepareCalendarDraft(userId, slotId, '1:1')
  useSession.setState({ remote: null })
  expect(() => remoteCalendar.book(userId, draft)).toThrow(ApiError)
})

test('время показывается в часовом поясе коллеги, а не браузера', () => {
  expect(formatCalendarTime('2030-01-01T12:00:00Z', 'Asia/Yakutsk', 'en')).toContain('21:00')
  expect(formatCalendarTime('2030-01-01T12:00:00Z', 'Europe/Moscow', 'en')).toContain('15:00')
  expect(calendarBookingSchema.safeParse(booking).success).toBe(true)
})
