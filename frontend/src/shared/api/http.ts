import { z } from 'zod'

/**
 * Типизированный клиент Go API (K-7). Каждый ответ проходит Zod-валидацию.
 * Режим задаётся переменной VITE_API_MODE:
 *   mock (по умолчанию) - данные из localStorage, бэкенд не нужен;
 *   http - запросы на VITE_API_URL по контракту из MVP_для_команды.md, раздел 7.
 */
export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'
export const IS_MOCK = API_MODE === 'mock'

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'buddy.token'
const REQUEST_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** Понятный человеку текст ошибки для UI. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof z.ZodError) return 'Сервис ответил в неожиданном формате'
  if (error instanceof Error) return error.message
  return 'Что-то пошло не так'
}

export const tokenStore = {
  get: (): string | null => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string): void => sessionStorage.setItem(TOKEN_KEY, token),
  clear: (): void => sessionStorage.removeItem(TOKEN_KEY),
}

const errorBodySchema = z.object({ error: z.string().optional(), code: z.string().optional() })

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Ключ идемпотентности для действий с эффектом (заявка на отгул). */
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(BASE_URL + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    })
  } catch {
    throw new ApiError(0, 'network', 'Сервис не отвечает. Проверь соединение и повтори')
  }

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(await response.json().catch(() => ({})))
    const body = parsed.success ? parsed.data : {}
    throw new ApiError(
      response.status,
      body.code ?? `http_${response.status}`,
      body.error ?? `Ошибка сервиса (${response.status})`,
    )
  }

  if (response.status === 204) return schema.parse(undefined)
  return schema.parse(await response.json())
}

/** Адрес SSE-потока ответа ассистента: GET /chat/stream/{id}. */
export function streamUrl(messageId: string): string {
  return `${BASE_URL}/chat/stream/${encodeURIComponent(messageId)}`
}
