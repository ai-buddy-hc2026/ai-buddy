import { z } from 'zod'
import { ApiError, IS_MOCK, request, setUnauthorizedHandler, toApiError, tokenStore } from './http'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
  setUnauthorizedHandler(() => undefined)
})

describe('http client', () => {
  test('без VITE_API_BASE_URL работает демо на моках', () => {
    expect(IS_MOCK).toBe(true)
  })

  test('разбирает ошибку бэкенда в формате {error: {code, message}}', () => {
    const error = toApiError(409, {
      error: { code: 'VERSION_CONFLICT', message: 'Задача изменилась' },
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.code).toBe('VERSION_CONFLICT')
    expect(error.message).toBe('Задача изменилась')
  })

  test('чужой формат ошибки даёт общий код http_<status>', () => {
    const error = toApiError(502, '<html>bad gateway</html>')
    expect(error.code).toBe('http_502')
  })

  test('передаёт Bearer-токен и валидирует ответ схемой', async () => {
    tokenStore.set('jwt-1')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await request('/health', z.object({ status: z.literal('ok') }), {
      query: { limit: 10, cursor: undefined },
    })

    expect(result).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/health?limit=10')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
  })

  test('неверная форма ответа - ZodError, а не тихий успех', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 1 })))
    await expect(request('/health', z.object({ status: z.string() }))).rejects.toBeInstanceOf(
      z.ZodError,
    )
  })

  test('401 с токеном очищает токен и вызывает выход на логин', async () => {
    tokenStore.set('expired')
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Нужен вход' } }),
        ),
    )

    await expect(request('/me', z.object({}))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(tokenStore.get()).toBeNull()
  })

  test('401 при входе без токена не считается истёкшей сессией', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'INVALID_LOGIN', message: 'Пользователь недоступен' },
        }),
      ),
    )

    await expect(request('/auth/mock-login', z.object({}))).rejects.toMatchObject({
      code: 'INVALID_LOGIN',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  test('сетевая ошибка превращается в понятный ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(request('/me', z.object({}))).rejects.toMatchObject({ status: 0, code: 'network' })
  })
})
