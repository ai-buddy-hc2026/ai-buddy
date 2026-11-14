import { z } from 'zod'

/**
 * Карта офиса (идеи 1 и 2): точки этажа и граф проходов. Данные тестовые.
 * Координаты - клетки сетки этажа 14 x 9 (x вправо, y вниз), по ним рисуется изометрия.
 */
export const placeTypeSchema = z.enum(['desk', 'kitchen', 'room', 'lift', 'medical'])
export type PlaceType = z.infer<typeof placeTypeSchema>

export const placeSchema = z.object({
  id: z.string(),
  floor: z.number().int(),
  type: placeTypeSchema,
  name: z.string(),
  /** Как ещё называют место: для нечёткого поиска из чата */
  aliases: z.array(z.string()),
  x: z.number(),
  y: z.number(),
  /** Размер в клетках */
  w: z.number(),
  d: z.number(),
  /** Для стола - чей он */
  employeeId: z.string().nullable(),
  /** Ближайший узел коридора */
  nodeId: z.string(),
})
export type Place = z.infer<typeof placeSchema>

export const FLOOR = { number: 3, cols: 14, rows: 9 } as const

const desk = (
  id: string,
  employeeId: string,
  name: string,
  x: number,
  y: number,
  nodeId: string,
): Place => ({
  id,
  floor: FLOOR.number,
  type: 'desk',
  name,
  aliases: [],
  x,
  y,
  w: 1,
  d: 1,
  employeeId,
  nodeId,
})

export const PLACES: readonly Place[] = [
  {
    id: 'lift',
    floor: 3,
    type: 'lift',
    name: 'Лифты',
    aliases: ['лифт', 'лифты', 'выход'],
    x: 0,
    y: 3,
    w: 1,
    d: 2,
    employeeId: null,
    nodeId: 'n-lift',
  },
  {
    id: 'kitchen',
    floor: 3,
    type: 'kitchen',
    name: 'Кухня',
    aliases: ['кухня', 'кофе', 'кофемашина', 'еда', 'обед'],
    x: 2,
    y: 0,
    w: 3,
    d: 2,
    employeeId: null,
    nodeId: 'n-kitchen',
  },
  {
    id: 'room-baikal',
    floor: 3,
    type: 'room',
    name: 'Переговорка Байкал',
    aliases: ['байкал', 'переговорка байкал'],
    x: 8,
    y: 0,
    w: 2,
    d: 2,
    employeeId: null,
    nodeId: 'n-baikal',
  },
  {
    id: 'room-altai',
    floor: 3,
    type: 'room',
    name: 'Переговорка Алтай',
    aliases: ['алтай', 'переговорка алтай'],
    x: 11,
    y: 0,
    w: 2,
    d: 2,
    employeeId: null,
    nodeId: 'n-altai',
  },
  {
    id: 'medical',
    floor: 3,
    type: 'medical',
    name: 'Медпункт',
    aliases: ['медпункт', 'врач', 'аптечка'],
    x: 0,
    y: 7,
    w: 2,
    d: 2,
    employeeId: null,
    nodeId: 'n-medical',
  },
  desk('desk-anya', 'anya', 'Стол Ани', 6, 5, 'n-desks'),
  desk('desk-ilya', 'ilya', 'Стол Ильи', 7, 5, 'n-desks'),
  desk('desk-sveta', 'sveta', 'Стол Светы', 6, 7, 'n-south'),
  desk('desk-oleg', 'oleg', 'Стол Олега', 7, 7, 'n-south'),
  desk('desk-maria', 'maria', 'Стол Марии', 11, 5, 'n-lead'),
  desk('desk-dasha', 'dasha', 'Стол Даши', 12, 7, 'n-lead'),
]

export interface MapNode {
  id: string
  x: number
  y: number
}

export interface MapEdge {
  from: string
  to: string
  /** Длина в метрах */
  length: number
  /** Подпись для текста маршрута при движении from -> to */
  hint: string
  /** Подпись при движении to -> from */
  hintBack: string
}

/** Узлы коридоров: главный коридор вдоль y = 3.5 и боковой проход вдоль x = 5. */
export const MAP_NODES: readonly MapNode[] = [
  { id: 'n-lift', x: 1, y: 3.5 },
  { id: 'n-kitchen', x: 3.5, y: 3.5 },
  { id: 'n-cross', x: 5, y: 3.5 },
  { id: 'n-baikal', x: 9, y: 3.5 },
  { id: 'n-lead', x: 11.5, y: 3.5 },
  { id: 'n-altai', x: 12, y: 3.5 },
  { id: 'n-desks', x: 5, y: 5.5 },
  { id: 'n-south', x: 5, y: 7.5 },
  { id: 'n-medical', x: 2, y: 7.5 },
]

export const MAP_EDGES: readonly MapEdge[] = [
  {
    from: 'n-lift',
    to: 'n-kitchen',
    length: 8,
    hint: 'от лифта направо по коридору',
    hintBack: 'по коридору к лифтам',
  },
  {
    from: 'n-kitchen',
    to: 'n-cross',
    length: 5,
    hint: 'мимо кухни до развилки',
    hintBack: 'от развилки к кухне',
  },
  {
    from: 'n-cross',
    to: 'n-baikal',
    length: 12,
    hint: 'прямо по коридору, вторая дверь слева',
    hintBack: 'по коридору назад до развилки',
  },
  {
    from: 'n-baikal',
    to: 'n-lead',
    length: 8,
    hint: 'дальше по коридору',
    hintBack: 'по коридору назад',
  },
  {
    from: 'n-lead',
    to: 'n-altai',
    length: 2,
    hint: 'последняя дверь слева',
    hintBack: 'к выходу из переговорки',
  },
  {
    from: 'n-cross',
    to: 'n-desks',
    length: 6,
    hint: 'на развилке направо, к столам команды',
    hintBack: 'от столов к главному коридору',
  },
  {
    from: 'n-desks',
    to: 'n-south',
    length: 6,
    hint: 'дальше вдоль столов',
    hintBack: 'назад вдоль столов',
  },
  {
    from: 'n-south',
    to: 'n-medical',
    length: 9,
    hint: 'в конце прохода направо',
    hintBack: 'от медпункта налево',
  },
]

export function getPlace(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id)
}

export function deskOf(employeeId: string): Place | undefined {
  return PLACES.find((p) => p.type === 'desk' && p.employeeId === employeeId)
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')

/**
 * MCP-инструмент find_place из ideas.md: «Байкал», «байкал», «переговорка байкал» дают одну точку.
 * Возвращает точное совпадение или до 3 похожих вариантов.
 */
export function findPlace(query: string): { match: Place | null; similar: Place[] } {
  const text = normalize(query)
  const words = text.split(/\s+/).filter((w) => w.length > 2)
  const scored = PLACES.map((place) => {
    const keys = [place.name, ...place.aliases].map(normalize)
    const exact = keys.some((key) => text.includes(key))
    const partial = keys.some((key) => words.some((w) => key.includes(w.slice(0, 4))))
    return { place, score: exact ? 2 : partial ? 1 : 0 }
  })
  const exact = scored.find((item) => item.score === 2)
  if (exact) return { match: exact.place, similar: [] }
  return {
    match: null,
    similar: scored
      .filter((item) => item.score === 1)
      .slice(0, 3)
      .map((item) => item.place),
  }
}

export interface Route {
  nodes: MapNode[]
  /** Метры */
  length: number
  /** Готовый текст: «от лифта направо по коридору, мимо кухни до развилки, ...» */
  text: string
}

/** Кратчайший путь между узлами коридора (Дейкстра). null - пути нет. */
export function findRoute(fromNodeId: string, toNodeId: string): Route | null {
  const nodeById = new Map(MAP_NODES.map((n) => [n.id, n]))
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return null

  const distance = new Map<string, number>(MAP_NODES.map((n) => [n.id, Infinity]))
  const previous = new Map<string, { node: string; hint: string }>()
  const pending = new Set(MAP_NODES.map((n) => n.id))
  distance.set(fromNodeId, 0)

  while (pending.size > 0) {
    let current: string | null = null
    for (const id of pending) {
      if (current === null || (distance.get(id) ?? Infinity) < (distance.get(current) ?? Infinity))
        current = id
    }
    if (current === null || distance.get(current) === Infinity) break
    pending.delete(current)
    if (current === toNodeId) break

    for (const edge of MAP_EDGES) {
      const isForward = edge.from === current
      const isBackward = edge.to === current
      if (!isForward && !isBackward) continue
      const neighbour = isForward ? edge.to : edge.from
      const candidate = (distance.get(current) ?? Infinity) + edge.length
      if (candidate < (distance.get(neighbour) ?? Infinity)) {
        distance.set(neighbour, candidate)
        previous.set(neighbour, { node: current, hint: isForward ? edge.hint : edge.hintBack })
      }
    }
  }

  const total = distance.get(toNodeId) ?? Infinity
  if (total === Infinity) return null

  const nodes: MapNode[] = []
  const hints: string[] = []
  let cursor: string | undefined = toNodeId
  while (cursor) {
    const node = nodeById.get(cursor)
    if (node) nodes.unshift(node)
    const step = previous.get(cursor)
    if (step) hints.unshift(step.hint)
    cursor = step?.node
  }
  return { nodes, length: total, text: hints.join(', ') }
}

/** Маршрут от места к месту (по умолчанию от лифта). */
export function routeToPlace(placeId: string, fromPlaceId = 'lift'): Route | null {
  const from = getPlace(fromPlaceId)
  const to = getPlace(placeId)
  if (!from || !to) return null
  return findRoute(from.nodeId, to.nodeId)
}
