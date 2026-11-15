import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSession } from '@/entities/session'
import { RemoteHoursTab } from './RemoteHoursTab'

const userId = 'a24a3478-cf42-51b1-b05b-9833260247a5'
const hostId = '4a59a828-3b1a-55e4-bf9b-81db5ad6183a'
const slot = {
  id: '30000000-0000-4000-8000-000000000001',
  employee_id: hostId,
  host_name: 'Илья',
  starts_at: '2030-01-01T12:00:00Z',
  ends_at: '2030-01-01T12:30:00Z',
  timezone: 'Europe/Moscow',
}
const host = {
  id: hostId,
  team_id: '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2',
  team_name: 'Команда',
  user_id: hostId,
  display_name: 'Илья',
  short_name: 'Илья',
  job_title: 'Наставник',
  kind: 'mentor',
  tags: [],
  ask_about: '',
  contact_handle: null,
  is_key_contact: true,
  sort_order: 1,
}
const booking = {
  ...slot,
  id: '50000000-0000-4000-8000-000000000001',
  slot_id: slot.id,
  attendee_id: userId,
  attendee_name: 'Аня',
  topic: '1:1',
  status: 'confirmed',
  confirmed_at: '2029-12-31T00:00:00Z',
}

function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RemoteHoursTab />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  localStorage.clear()
  useSession.setState({
    login: 'intern_anya',
    remote: { id: userId, login: 'intern_anya', name: 'Аня', role: 'intern', teamName: 'Команда' },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  useSession.setState({ login: null, remote: null })
})

test('выбор слота не создаёт бронь; явное подтверждение сохраняет результат', async () => {
  let saved = false
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/employees'))
      return new Response(JSON.stringify({ items: [host], next_cursor: null }))
    if (options?.method === 'POST') {
      saved = true
      return new Response(JSON.stringify(booking))
    }
    if (url.includes('/office-hours'))
      return new Response(JSON.stringify({ items: saved ? [] : [slot] }))
    return new Response(JSON.stringify({ items: saved ? [booking] : [] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  mount()
  const slots = await screen.findByRole('list', { name: 'Свободные слоты' })
  fireEvent.click(within(slots).getByRole('button'))
  const dialog = await screen.findByRole('dialog')
  expect(saved).toBe(false)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Записаться' }))
  expect(await within(dialog).findByText('Бронь сохранена')).toBeInTheDocument()
  await waitFor(() => expect(saved).toBe(true))
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})

test('конфликт слота показывает ошибку и обновляет доступность', async () => {
  let conflict = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/employees'))
        return new Response(JSON.stringify({ items: [host], next_cursor: null }))
      if (options?.method === 'POST') {
        conflict = true
        return new Response(
          JSON.stringify({ error: { code: 'SLOT_UNAVAILABLE', message: 'Слот уже занят' } }),
          { status: 409 },
        )
      }
      if (url.includes('/office-hours'))
        return new Response(JSON.stringify({ items: conflict ? [] : [slot] }))
      return new Response(JSON.stringify({ items: [] }))
    }),
  )
  mount()
  fireEvent.click(
    within(await screen.findByRole('list', { name: 'Свободные слоты' })).getByRole('button'),
  )
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записаться' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Слот уже занят')
  expect(await screen.findByText('Свободных приёмных слотов нет')).toBeInTheDocument()
})

test('при смене сессии предыдущий календарь не отображается', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/employees'))
        return new Response(
          JSON.stringify({
            items: useSession.getState().remote?.id === userId ? [host] : [],
            next_cursor: null,
          }),
        )
      return new Response(JSON.stringify({ items: [] }))
    }),
  )
  mount()
  expect(await screen.findByRole('button', { name: 'Илья · Наставник' })).toBeInTheDocument()
  act(() =>
    useSession.setState({
      remote: {
        id: '2db7cc77-4114-52d8-a833-f670ab60e4e0',
        login: 'intern_petr',
        name: 'Пётр',
        role: 'intern',
        teamName: 'Другая команда',
      },
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Илья · Наставник' })).not.toBeInTheDocument(),
  )
})
