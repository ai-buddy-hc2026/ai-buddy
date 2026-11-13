import { z } from 'zod'

/**
 * Типизированный клиент Go API (docs/openapi.yaml). Каждый ответ проходит Zod-валидацию.
 *
 * Режим работы - одно правило:
 *   VITE_API_BASE_URL задан и не пустой - фронт ходит в реальный API по этому адресу;
 *   VITE_API_BASE_URL не задан или пустой - демо на моках из localStorage, бэкенд не нужен.
 * В dev и в Docker адрес обычно `/api`: запросы идут через прокси Vite или nginx,
 * поэтому CORS на бэкенде не нужен. Подробности в frontend/.env.example.
 */
const RAW_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim()

export const USE_REAL_API = RAW_BASE_URL.length > 0
export const IS_MOCK = !USE_REAL_API
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '')

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
  get: (): string | null => {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (token: string): void => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      // Хранилище недоступно: запросы пойдут без токена, бэкенд ответит 401
    }
  },
  clear: (): void => {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      // Нечего очищать
    }
  },
}

/* ---------- 401: выход на экран входа ---------- */

let onUnauthorized: () => void = () => undefined

/** Регистрирует реакцию на 401 с отправленным токеном (app/router.tsx). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

/* ---------- Ошибки бэкенда: {error: {code, message}} ---------- */

export const errorBodySchema = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
})

/** Разбирает тело ошибки по контракту; при чужом формате даёт общий код http_<status>. */
export function toApiError(status: number, body: unknown): ApiError {
  const parsed = errorBodySchema.safeParse(body)
  if (parsed.success) return new ApiError(status, parsed.data.error.code, parsed.data.error.message)
  return new ApiError(status, `http_${status}`, `Ошибка сервиса (${status})`)
}

export const NETWORK_ERROR_CODE = 'network'

export function networkError(): ApiError {
  return new ApiError(0, NETWORK_ERROR_CODE, 'Сервис не отвечает. Проверь соединение и повтори')
}

/* ---------- Запросы ---------- */

type Query = Record<string, string | number | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  signal?: AbortSignal
  /** Без таймаута: для SSE-потока, который живёт дольше обычного запроса */
  isLongLived?: boolean
  accept?: string
  headers?: Record<string, string>
}

export function buildUrl(path: string, query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return `${API_BASE_URL}${path}${search ? `?${search}` : ''}`
}

/** Низкоуровневый fetch с токеном и разбором ошибок. Возвращает успешный Response. */
export async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
    ...options.headers,
  }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const timeout = options.isLongLived ? undefined : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signals = [options.signal, timeout].filter((s): s is AbortSignal => s !== undefined)

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
    })
  } catch (cause) {
    if (options.signal?.aborted) throw cause
    throw networkError()
  }

  if (response.ok) return response
  const body: unknown = await response.json().catch(() => null)
  const error = toApiError(response.status, body)
  if (response.status === 401 && token) {
    tokenStore.clear()
    onUnauthorized()
  }
  throw error
}

/** JSON-запрос с Zod-валидацией ответа. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options)
  if (response.status === 204) return schema.parse(undefined)
  return schema.parse(await response.json())
}
