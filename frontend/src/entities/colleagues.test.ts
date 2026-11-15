import { tokenStore } from '@/shared/api/http'
import { colleagueSchema, remoteColleagues } from './colleagues'

export const colleagueFixture = {
  id: '20000000-0000-4000-8000-000000000001',
  team_id: '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2',
  team_name: 'Тестовая команда',
  user_id: null,
  display_name: 'Олег Тестовый',
  short_name: 'Олег',
  job_title: 'DevOps',
  kind: 'colleague',
  tags: ['мониторинг'],
  ask_about: 'Мониторинг и деплой',
  contact_handle: '@oleg_demo',
  is_key_contact: true,
  sort_order: 15,
} as const

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

test('справочник отправляет авторизацию, поиск, курсор и сигнал отмены', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [colleagueFixture], next_cursor: 'next' })),
    )
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set('test-token')
  const controller = new AbortController()
  const page = await remoteColleagues.list(' мониторинг ', 'cursor', controller.signal)
  expect(page.items[0].user_id).toBeNull()
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toContain('q=%D0%BC%D0%BE%D0%BD%D0%B8%D1%82%D0%BE%D1%80%D0%B8%D0%BD%D0%B3')
  expect(url).toContain('cursor=cursor')
  expect(options.headers.Authorization).toBe('Bearer test-token')
  controller.abort()
  expect(options.signal.aborted).toBe(true)
})

test('API-ошибка не подменяется демонстрационными коллегами', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  await expect(remoteColleagues.list()).rejects.toMatchObject({ status: 503 })
})

test('карточка не принимает псевдо-ID и неизвестную категорию', () => {
  expect(colleagueSchema.safeParse({ ...colleagueFixture, id: 'oleg' }).success).toBe(false)
  expect(colleagueSchema.safeParse({ ...colleagueFixture, kind: 'admin' }).success).toBe(false)
  expect(
    colleagueSchema.safeParse({ ...colleagueFixture, id: '00000000-0000-0000-0000-000000000000' })
      .success,
  ).toBe(false)
  expect(
    colleagueSchema.safeParse({
      ...colleagueFixture,
      id: '10000000-0000-0000-0000-000000000003',
      user_id: '10000000-0000-0000-0000-000000000003',
    }).success,
  ).toBe(true)
})
