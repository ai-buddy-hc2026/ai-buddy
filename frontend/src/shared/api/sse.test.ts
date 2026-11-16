import { parseSse, readSse, type SseFrame } from './sse'

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseFrame[]> {
  const frames: SseFrame[] = []
  for await (const frame of readSse(stream)) frames.push(frame)
  return frames
}

describe('SSE parser', () => {
  test('разбирает id, event и data, хвост оставляет на потом', () => {
    const { frames, rest } = parseSse('id: r:1\nevent: token\ndata: {"a":1}\n\nid: r:2\nda')
    expect(frames).toEqual([{ id: 'r:1', event: 'token', data: '{"a":1}' }])
    expect(rest).toBe('id: r:2\nda')
  })

  test('пропускает комментарии : ping и понимает CRLF', () => {
    const { frames } = parseSse(': ping\r\n\r\nevent: done\r\ndata: x\r\n\r\n')
    expect(frames).toEqual([{ id: null, event: 'done', data: 'x' }])
  })

  test('склеивает многострочный data через перевод строки', () => {
    const { frames } = parseSse('data: first\ndata: second\n\n')
    expect(frames[0].data).toBe('first\nsecond')
    expect(frames[0].event).toBe('message')
  })

  test('собирает кадры, разрезанные между кусками потока', async () => {
    const frames = await collect(
      streamOf(['id: r:1\nevent: tok', 'en\ndata: {"t":"При', 'вет"}\n', '\n: ping\n\n']),
    )
    expect(frames).toEqual([{ id: 'r:1', event: 'token', data: '{"t":"Привет"}' }])
  })

  test('отдаёт последний кадр без завершающей пустой строки', async () => {
    const frames = await collect(streamOf(['event: done\ndata: end']))
    expect(frames).toEqual([{ id: null, event: 'done', data: 'end' }])
  })
})
