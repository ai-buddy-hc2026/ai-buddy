import { ApiError, tokenStore } from '@/shared/api/http'
import {
  notificationSchema,
  notificationResourceSchema,
  remoteNotifications,
} from './notifications'
import { useSession } from './session'

const userId = 'a24a3478-cf42-51b1-b05b-9833260247a5'
const notice = {
  id: '10000000-0000-0000-0000-000000000003',
  kind: 'booking_confirmed',
  booking_id: '50000000-0000-4000-8000-000000000001',
  escalation_id: null,
  created_at: '2030-01-01T12:00:00Z',
  read_at: null,
  starts_at: '2030-01-02T12:00:00Z',
  timezone: 'Europe/Moscow',
  person_name: 'Илья',
  question_preview: null,
}
const settings = {
  version: 4,
  preferences: { meeting_reminders: false },
  work_days: [1, 2, 3, 4, 5],
  work_start: '10:00',
  work_end: '19:00',
}
beforeEach(() => {
  useSession.setState({
    remote: { id: userId, login: 'intern_anya', name: 'Аня', role: 'intern', teamName: 'Команда' },
  })
  tokenStore.set('synthetic-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
  useSession.setState({ remote: null })
})

test('контракт допускает существующие UUID и отвергает неизвестные типы', () => {
  expect(notificationSchema.safeParse(notice).success).toBe(true)
  expect(notificationSchema.safeParse({ ...notice, kind: 'unknown' }).success).toBe(false)
  expect(
    notificationResourceSchema.safeParse({ type: 'url', url: 'https://example.com' }).success,
  ).toBe(false)
})
test('настройки отправляют версию и часы без данных о режиме или владельце', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ...settings, timezone: 'Europe/Moscow' })))
  vi.stubGlobal('fetch', fetchMock)
  await remoteNotifications.updateSettings(userId, settings)
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toMatch(/\/me\/settings$/)
  expect(JSON.parse(options.body)).toEqual(settings)
  expect(options.headers.Authorization).toBe('Bearer synthetic-token')
})
test('чтение не передаёт получателя, повтор безопасен для транспорта', async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ...notice, read_at: '2030-01-01T12:01:00Z' }))),
    )
  vi.stubGlobal('fetch', fetchMock)
  await remoteNotifications.read(userId, notice.id)
  await remoteNotifications.read(userId, notice.id)
  expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/notifications/${notice.id}/read$`))
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' })
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
})
test('выход блокирует старые команды без отправки HTTP', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  useSession.setState({ remote: null })
  expect(() => remoteNotifications.read(userId, notice.id)).toThrow(ApiError)
  expect(() => remoteNotifications.updateSettings(userId, settings)).toThrow(ApiError)
  expect(fetchMock).not.toHaveBeenCalled()
})
test('ошибка сервера не заменяется локальными уведомлениями', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Недоступно' } }),
          { status: 503 },
        ),
      ),
  )
  await expect(remoteNotifications.list()).rejects.toMatchObject({ status: 503 })
})
