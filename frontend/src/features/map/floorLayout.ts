import { FLOOR, MAP_EDGES, MAP_NODES, type Place, type PlaceType } from '@/entities/places'
import type { IsoGrid } from '@/shared/iso'
import type { IconName } from '@/shared/ui'

/** Геометрия изометрического плана этажа. Клетка сетки = 1 x 1 из entities/places. */
const TILE_W = 30
const TILE_H = 17
const PAD = 16
/** Запас сверху под высокие объекты и метки */
const TOP_SPACE = 48
export const SLAB_DEPTH = 10
const CORRIDOR_HALF = 0.5
const DESK_INSET = 0.14

export const SCENE_GRID: IsoGrid = {
  tileW: TILE_W,
  tileH: TILE_H,
  originX: PAD + FLOOR.rows * TILE_W,
  originY: PAD + TOP_SPACE,
}
export const SCENE_WIDTH = (FLOOR.cols + FLOOR.rows) * TILE_W + PAD * 2
export const SCENE_HEIGHT =
  SCENE_GRID.originY + (FLOOR.cols + FLOOR.rows) * TILE_H + SLAB_DEPTH + PAD

/** Высота линии маршрута над полом, px */
export const ROUTE_Z = 1

/* Метки над объектами */
export const PIN_PILL_H = 22
const PIN_CHAR_W = 7
const PIN_PILL_PAD = 10
export const PIN_STEM = { me: 30, mentor: 72, target: 44 } as const
export type PinTone = keyof typeof PIN_STEM

export interface TypeMeta {
  label: { ru: string; en: string }
  icon: IconName
  color: string
  /** Высота объекта, px */
  height: number
}

export const TYPE_META: Record<PlaceType, TypeMeta> = {
  desk: {
    label: { ru: 'Столы', en: 'Desks' },
    icon: 'user',
    color: 'var(--brand-blue)',
    height: 12,
  },
  room: {
    label: { ru: 'Переговорки', en: 'Rooms' },
    icon: 'calendar',
    color: 'var(--brand-violet)',
    height: 36,
  },
  kitchen: {
    label: { ru: 'Кухня', en: 'Kitchen' },
    icon: 'coffee',
    color: 'var(--brand-green)',
    height: 24,
  },
  lift: {
    label: { ru: 'Лифты', en: 'Lifts' },
    icon: 'chevronUp',
    color: 'var(--brand-yellow)',
    height: 48,
  },
  medical: {
    label: { ru: 'Медпункт', en: 'First aid' },
    icon: 'heart',
    color: 'var(--brand-red)',
    height: 28,
  },
}

export const TYPE_ORDER: readonly PlaceType[] = ['desk', 'room', 'kitchen', 'lift', 'medical']

export interface FloorRect {
  x: number
  y: number
  w: number
  d: number
}

/** Полосы коридора: по одной на ребро графа, шириной в одну клетку. */
export function corridorRects(): FloorRect[] {
  const nodeById = new Map(MAP_NODES.map((node) => [node.id, node]))
  return MAP_EDGES.flatMap((edge) => {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) return []
    return [
      {
        x: Math.min(from.x, to.x) - CORRIDOR_HALF,
        y: Math.min(from.y, to.y) - CORRIDOR_HALF,
        w: Math.abs(from.x - to.x) + CORRIDOR_HALF * 2,
        d: Math.abs(from.y - to.y) + CORRIDOR_HALF * 2,
      },
    ]
  })
}

/** Пятно объекта на полу: столы чуть меньше клетки, чтобы между ними был проход. */
export function placeFootprint(place: Place): FloorRect {
  const inset = place.type === 'desk' ? DESK_INSET : 0
  return { x: place.x + inset, y: place.y + inset, w: place.w - inset * 2, d: place.d - inset * 2 }
}

/** Ширина «таблетки» метки по длине подписи. */
export function pinWidth(label: string): number {
  return label.length * PIN_CHAR_W + PIN_PILL_PAD * 2
}
