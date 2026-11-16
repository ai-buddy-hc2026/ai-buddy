import { ApiError, send } from './http'

/**
 * Чтение SSE через fetch + ReadableStream. Нативный EventSource не умеет заголовок
 * Authorization, а JWT в URL передавать нельзя (docs/openapi.yaml, /chat/stream/{id}).
 */
export interface SseFrame {
  id: string | null
  event: string
  data: string
}

function parseBlock(block: string): SseFrame | null {
  let id: string | null = null
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    // Пустые строки и комментарии (`: ping`) не несут данных
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? '' : line.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id') id = value
  }
  return data.length === 0 ? null : { id, event, data: data.join('\n') }
}

/**
 * Чистый парсер: из накопленного текста достаёт законченные кадры (разделитель - пустая строка),
 * незаконченный хвост возвращает в rest для следующего куска потока.
 */
export function parseSse(input: string): { frames: SseFrame[]; rest: string } {
  const blocks = input.replace(/\r\n?/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const frames = blocks.map(parseBlock).filter((frame): frame is SseFrame => frame !== null)
  return { frames, rest }
}

/** Читает поток кадр за кадром. Последний кадр без завершающей пустой строки тоже отдаётся. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = parseSse(rest + decoder.decode(value, { stream: true }))
      rest = parsed.rest
      yield* parsed.frames
    }
    yield* parseSse(`${rest}${decoder.decode()}\n\n`).frames
  } finally {
    reader.releaseLock()
  }
}

export interface OpenStreamOptions {
  lastEventId?: string
  signal?: AbortSignal
}

/** Открывает SSE с Bearer-токеном. HTTP-ошибки до открытия потока приходят как ApiError. */
export async function openSse(
  path: string,
  options: OpenStreamOptions = {},
): Promise<AsyncGenerator<SseFrame>> {
  const response = await send(path, {
    accept: 'text/event-stream',
    isLongLived: true,
    signal: options.signal,
    headers: options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : undefined,
  })
  if (!response.body) throw new ApiError(0, 'STREAM_INTERRUPTED', 'Поток ответа не открылся')
  return readSse(response.body)
}
