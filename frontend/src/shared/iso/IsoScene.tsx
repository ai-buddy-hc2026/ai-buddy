import type { CSSProperties, ReactNode, SVGProps } from 'react'
import { createContext, useContext } from 'react'
import { cn } from '@/shared/lib/cn'
import { boxFaces, shade, sortByDepth, toPoints, type Box, type IsoGrid, type Point3 } from './iso'
import s from './iso.module.css'

const GridContext = createContext<IsoGrid | null>(null)

export function useIsoGrid(): IsoGrid {
  const grid = useContext(GridContext)
  if (!grid) throw new Error('Iso-примитивы работают только внутри <IsoScene>')
  return grid
}

type IsoSceneProps = Omit<SVGProps<SVGSVGElement>, 'viewBox'> & {
  width: number
  height: number
  grid: IsoGrid
  /** Подпись для экранного диктора. Без неё сцена декоративная. */
  label?: string
  children: ReactNode
}

/**
 * Холст для изометрии. Внутри используются IsoBox, IsoTile, IsoPoly.
 * Рисуй объекты от дальних к ближним (или отсортируй через sortByDepth).
 */
export function IsoScene({
  width,
  height,
  grid,
  label,
  className,
  children,
  ...rest
}: IsoSceneProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn(s.scene, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <GridContext.Provider value={grid}>{children}</GridContext.Provider>
    </svg>
  )
}

type IsoBoxProps = Box & {
  /** Любой CSS-цвет: var(--brand-blue), var(--theme-palette-...) */
  color: string
  className?: string
}

/** Параллелепипед с тремя гранями разной яркости. */
export function IsoBox({ color, className, ...box }: IsoBoxProps) {
  const faces = boxFaces(useIsoGrid(), box)
  return (
    <g className={className}>
      <polygon points={faces.left} style={{ fill: shade(color, 86) }} />
      <polygon points={faces.right} style={{ fill: shade(color, 70) }} />
      <polygon points={faces.top} style={{ fill: color }} />
    </g>
  )
}

/** Плоская плитка на высоте z. */
export function IsoTile({
  x,
  y,
  z = 0,
  w,
  d,
  color,
  className,
}: Omit<Box, 'h'> & { color?: string; className?: string }) {
  const points = toPoints(useIsoGrid(), [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
  ])
  return (
    <polygon points={points} className={className} style={color ? { fill: color } : undefined} />
  )
}

/** Произвольный многоугольник по точкам в координатах сетки. */
export function IsoPoly({
  points,
  color,
  className,
  style,
}: {
  points: readonly Point3[]
  color?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <polygon
      points={toPoints(useIsoGrid(), points)}
      className={className}
      style={color ? { fill: color, ...style } : style}
    />
  )
}

/* ---------- Готовые мини-иллюстрации из кубиков ---------- */

type ArtBox = Box & { color: string }

const G = 'var(--brand-green)'
const B = 'var(--brand-blue)'
const R = 'var(--brand-red)'
const V = 'var(--brand-violet)'
const Y = 'var(--brand-yellow)'
const W = 'var(--iso-plot)'
const K = 'var(--iso-ink)'

const ART = {
  /** Чат: два «пузыря» */
  chat: [
    { x: 0, y: 0.6, z: 26, w: 2.2, d: 1.2, h: 12, color: B },
    { x: 0.3, y: 1.5, z: 16, w: 0.5, d: 0.3, h: 10, color: B },
    { x: 1.4, y: 1.6, z: 4, w: 1.8, d: 1, h: 10, color: G },
  ],
  /** Календарь */
  calendar: [
    { x: 0, y: 0, w: 2.4, d: 2.4, h: 8, color: W },
    { x: 0, y: 0, z: 8, w: 2.4, d: 0.7, h: 5, color: R },
    { x: 0.4, y: 1.1, z: 8, w: 0.5, d: 0.5, h: 3, color: B },
    { x: 1.4, y: 1.1, z: 8, w: 0.5, d: 0.5, h: 3, color: Y },
    { x: 0.4, y: 1.8, z: 8, w: 0.5, d: 0.5, h: 3, color: G },
  ],
  /** Кубок: достижения */
  trophy: [
    { x: 0.4, y: 0.4, w: 1.6, d: 1.6, h: 8, color: K },
    { x: 0.9, y: 0.9, z: 8, w: 0.6, d: 0.6, h: 16, color: Y },
    { x: 0.4, y: 0.4, z: 24, w: 1.6, d: 1.6, h: 22, color: Y },
  ],
  /** Чашка кофе: random coffee */
  coffee: [
    { x: 0, y: 0, w: 2.4, d: 2.4, h: 4, color: W },
    { x: 0.5, y: 0.5, z: 4, w: 1.4, d: 1.4, h: 22, color: V },
    { x: 0.7, y: 0.7, z: 26, w: 1, d: 1, h: 2, color: K },
    { x: 1.9, y: 0.9, z: 10, w: 0.4, d: 0.5, h: 10, color: V },
  ],
  /** Замок: приватность */
  lock: [
    { x: 0.6, y: 0.9, z: 26, w: 0.35, d: 0.35, h: 16, color: K },
    { x: 1.45, y: 0.9, z: 26, w: 0.35, d: 0.35, h: 16, color: K },
    { x: 0.6, y: 0.9, z: 42, w: 1.2, d: 0.35, h: 6, color: K },
    { x: 0.2, y: 0.5, w: 2, d: 1.2, h: 26, color: V },
  ],
  /** Стопка книг: знания и курсы */
  books: [
    { x: 0, y: 0, w: 2.4, d: 1.6, h: 9, color: B },
    { x: 0.2, y: 0.1, z: 9, w: 2.1, d: 1.4, h: 9, color: R },
    { x: 0.1, y: 0.2, z: 18, w: 1.9, d: 1.2, h: 9, color: G },
  ],
  /** Пустой участок с флажком: пустые состояния */
  plot: [
    { x: 0, y: 0, w: 2.6, d: 2.6, h: 5, color: W },
    { x: 1.2, y: 1.2, z: 5, w: 0.14, d: 0.14, h: 34, color: K },
    { x: 1.34, y: 1.2, z: 27, w: 0.8, d: 0.1, h: 12, color: R },
  ],
  /** Три башни: аналитика */
  chart: [
    { x: 0, y: 1.6, w: 0.8, d: 0.8, h: 16, color: G },
    { x: 0.9, y: 0.9, w: 0.8, d: 0.8, h: 30, color: B },
    { x: 1.8, y: 0.2, w: 0.8, d: 0.8, h: 46, color: V },
  ],
  /** Ключ-карта: доступы */
  access: [
    { x: 0, y: 0.3, w: 2.6, d: 1.7, h: 6, color: G },
    { x: 0.3, y: 0.6, z: 6, w: 0.8, d: 0.8, h: 3, color: W },
    { x: 1.4, y: 0.7, z: 6, w: 0.9, d: 0.2, h: 2, color: K },
    { x: 1.4, y: 1.2, z: 6, w: 0.6, d: 0.2, h: 2, color: K },
  ],
} satisfies Record<string, ArtBox[]>

export type IsoArtName = keyof typeof ART

const ART_GRID: IsoGrid = { tileW: 22, tileH: 12.5, originX: 70, originY: 44 }

/** Маленькая изометрическая иллюстрация 140x120 для пустых состояний и заголовков. */
export function IsoArt({
  name,
  className,
  isFloating = false,
}: {
  name: IsoArtName
  className?: string
  isFloating?: boolean
}) {
  const boxes: ArtBox[] = ART[name]
  return (
    <IsoScene width={140} height={120} grid={ART_GRID} className={className}>
      <ellipse cx={70} cy={104} rx={54} ry={10} className={s.shadow} />
      <g className={isFloating ? s.float : undefined}>
        {sortByDepth(boxes).map((box, i) => (
          <IsoBox key={i} {...box} />
        ))}
      </g>
    </IsoScene>
  )
}

export const ISO_ART_NAMES = Object.keys(ART) as IsoArtName[]
