import { tokenStore } from '@/shared/api/http'
import { remoteActions, remoteAuth, remoteChat, remotePlan } from './remote'
import {
  ACTION_ID,
  ANYA_ID,
  REQUEST_ID,
  TASK_ID,
  apiAction,
  apiPlan,
  apiTask,
  apiUser,
  jsonResponse,
} from './fixtures.test-data'

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function frame(seq: number, event: string, data: unknown): string {
  const envelope = { event, request_id: REQUEST_ID, seq, data }
  return `id: ${REQUEST_ID}:${seq}\nevent: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`
}

function calls(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls as Array<[string, RequestInit]>
}

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const intern = {
  id: ANYA_ID,
  login: 'intern_anya',
  name: 'Anya',
  role: 'intern',
  teamName: 'T',
} as const

describe('remote auth', () => {
  test('mock-login сохраняет токен, профиль берётся из /me', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'jwt',
          token_type: 'Bearer',
          expires_in: 3600,
          user: apiUser(),
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, apiUser()))
    vi.stubGlobal('fetch', fetchMock)

    const user = await remoteAuth.signIn('intern_anya')

    expect(user).toEqual({ ...intern, teamName: 'Team 1' })
    expect(tokenStore.get()).toBe('jwt')
    const [, meInit] = calls(fetchMock)[1]
    expect(calls(fetchMock)[1][0]).toBe('/me')
    expect((meInit.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
  })
})

describe('remote plan', () => {
  test('PATCH отправляет status и актуальную version', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, apiPlan([apiTask({ version: 3 })])))
      .mockResolvedValueOnce(jsonResponse(200, apiTask({ status: 'done', version: 4 })))
    vi.stubGlobal('fetch', fetchMock)

    const plan = await remotePlan.setStatus(intern, TASK_ID, 'done')

    const [url, init] = calls(fetchMock)[1]
    expect(url).toBe(`/tasks/${TASK_ID}`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ status: 'done', version: 3 })
    expect(plan.tasks[0].status).toBe('done')
  })

  test('409 VERSION_CONFLICT доходит до UI как ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, apiPlan()))
        .mockResolvedValueOnce(
          jsonResponse(409, { error: { code: 'VERSION_CONFLICT', message: 'Задача изменилась' } }),
        ),
    )
    await expect(remotePlan.setStatus(intern, TASK_ID, 'done')).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
    })
  })

  test('наставник читает план назначенного стажёра через intern_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { items: [apiUser()], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse(200, apiPlan()))
    vi.stubGlobal('fetch', fetchMock)

    await remotePlan.get({ ...intern, role: 'buddy' })

    expect(calls(fetchMock)[1][0]).toBe(`/onboarding/plan?intern_id=${ANYA_ID}`)
  })
})

describe('remote actions', () => {
  test('confirm без тела; failed превращается в ошибку с «Повторить»', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...apiAction({
          status: 'failed',
          last_error: { code: 'SERVICE_UNAVAILABLE', message: 'Сервис отсутствий не ответил' },
        }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(remoteActions.confirm(ACTION_ID)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Сервис отсутствий не ответил',
    })
    const [url, init] = calls(fetchMock)[0]
    expect(url).toBe(`/actions/${ACTION_ID}/confirm`)
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })
})

describe('remote chat stream', () => {
  test('отдаёт события по порядку, пропускает дубли seq и ping, закрывается на done', async () => {
    const body =
      frame(1, 'token', { text: 'При' }) +
      ': ping\n\n' +
      frame(1, 'token', { text: 'При' }) +
      frame(2, 'token', { text: 'вет' }) +
      frame(3, 'done', { full_text: 'Привет', sources: [] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(body)))

    const events = []
    for await (const event of remoteChat.events(REQUEST_ID)) events.push(event)

    expect(events.map((e) => `${e.seq}:${e.event}`)).toEqual(['1:token', '2:token', '3:done'])
  })

  test('после обрыва переподключается с Last-Event-ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(frame(1, 'token', { text: 'a' })))
      .mockResolvedValueOnce(sseResponse(frame(2, 'done', { full_text: 'ab', sources: [] })))
    vi.stubGlobal('fetch', fetchMock)

    const events = []
    for await (const event of remoteChat.events(REQUEST_ID)) events.push(event)

    expect(events).toHaveLength(2)
    const [, retryInit] = calls(fetchMock)[1]
    expect((retryInit.headers as Record<string, string>)['Last-Event-ID']).toBe(`${REQUEST_ID}:1`)
  })

  test('событие не по контракту - ошибка INVALID_AI_EVENT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('event: token\ndata: {oops}\n\n')))
    const read = async () => {
      for await (const event of remoteChat.events(REQUEST_ID)) void event
    }
    await expect(read()).rejects.toMatchObject({ code: 'INVALID_AI_EVENT' })
  })

  test('HTTP-ошибка до открытия потока не переподключается', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Нет запроса' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const read = async () => {
      for await (const event of remoteChat.events(REQUEST_ID)) void event
    }
    await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
