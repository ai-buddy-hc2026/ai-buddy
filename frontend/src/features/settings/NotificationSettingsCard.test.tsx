import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSession } from '@/entities/session'
import { NotificationSettingsCard } from './NotificationSettingsCard'

const userId = 'a24a3478-cf42-51b1-b05b-9833260247a5'
const initial = {
  version: 1,
  preferences: { meeting_reminders: true },
  work_days: [1, 2, 3, 4, 5],
  work_start: '10:00',
  work_end: '19:00',
  timezone: 'Europe/Moscow',
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NotificationSettingsCard />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  useSession.setState({
    remote: { id: userId, login: 'intern_anya', name: 'Аня', role: 'intern', teamName: 'Команда' },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useSession.setState({ remote: null })
})

test('конфликт версии сохраняет черновик до явной загрузки актуальных настроек', async () => {
  let conflict = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        conflict = true
        return new Response(
          JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Настройки изменились' } }),
          { status: 409 },
        )
      }
      return new Response(
        JSON.stringify(conflict ? { ...initial, version: 2, work_start: '08:00' } : initial),
      )
    }),
  )
  mount()
  const start = await screen.findByLabelText('Начало рабочего дня')
  fireEvent.change(start, { target: { value: '09:30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить напоминания' }))
  await screen.findByRole('alert')
  expect(start).toHaveValue('09:30')
  fireEvent.click(screen.getByRole('button', { name: 'Загрузить актуальные настройки' }))
  await screen.findByDisplayValue('08:00')
})
test('смена пользователя во время чтения не показывает его часы в новой сессии', async () => {
  let resolveOld!: (response: Response) => void
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      ++calls === 1
        ? new Promise<Response>((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve(new Response(JSON.stringify({ ...initial, work_start: '08:00' }))),
    ),
  )
  mount()
  await act(async () => {
    useSession.setState({
      remote: {
        id: '2db7cc77-4114-52d8-a833-f670ab60e4e0',
        login: 'intern_petr',
        name: 'Пётр',
        role: 'intern',
        teamName: 'Другая',
      },
    })
  })
  await screen.findByDisplayValue('08:00')
  await act(async () => {
    resolveOld(new Response(JSON.stringify(initial)))
  })
  expect(screen.queryByDisplayValue('10:00')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Начало рабочего дня')).toHaveValue('08:00')
})
