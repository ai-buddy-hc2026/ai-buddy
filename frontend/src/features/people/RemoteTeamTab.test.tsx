import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from '@/entities/session'
import { RemoteTeamTab } from './RemoteTeamTab'

const employee = {
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
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RemoteTeamTab />
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  useSession.setState({
    login: 'intern_anya',
    remote: {
      id: 'a24a3478-cf42-51b1-b05b-9833260247a5',
      login: 'intern_anya',
      name: 'Аня',
      role: 'intern',
      teamName: 'Команда',
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useSession.setState({ login: null, remote: null })
})

test('показывает серверную карточку и пустой результат поиска без выдуманного статуса', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [employee], next_cursor: null })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], next_cursor: null })))
  vi.stubGlobal('fetch', fetchMock)
  mount()
  expect(await screen.findByRole('article', { name: employee.display_name })).toBeInTheDocument()
  expect(screen.getByText('Мониторинг и деплой')).toBeInTheDocument()
  expect(screen.getByText('@oleg_demo')).toBeInTheDocument()
  expect(screen.queryByText('в сети')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Написать' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск коллег' }), {
    target: { value: 'неизвестно' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Найти' }))
  expect(await screen.findByText('Коллеги не найдены')).toBeInTheDocument()
  expect(screen.queryByText(employee.display_name)).not.toBeInTheDocument()
})

test('при отказе API показывает ошибку и повтор, а не демонстрационный список', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  mount()
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

test('смена пользователя не показывает предыдущую команду', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [employee], next_cursor: null })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], next_cursor: null })))
  vi.stubGlobal('fetch', fetchMock)
  mount()
  expect(await screen.findByText(employee.display_name)).toBeInTheDocument()
  act(() =>
    useSession.setState({
      login: 'intern_petr',
      remote: {
        id: '2db7cc77-4114-52d8-a833-f670ab60e4e0',
        login: 'intern_petr',
        name: 'Пётр',
        role: 'intern',
        teamName: 'Другая команда',
      },
    }),
  )
  await waitFor(() => expect(screen.queryByText(employee.display_name)).not.toBeInTheDocument())
  expect(await screen.findByText('В справочнике пока нет коллег')).toBeInTheDocument()
})
