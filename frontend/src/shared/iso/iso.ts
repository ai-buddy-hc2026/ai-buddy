/**
 * Изометрическая проекция для SVG. Ось x уходит вправо-вниз, y - влево-вниз, z - вверх (в пикселях).
 * Одна клетка сетки = ромб tileW*2 на tileH*2.
 */
export interface IsoGrid {
  tileW: number
  tileH: number
  originX: number
  originY: number
}

export type Point3 = readonly [x: number, y: number, z: number]

export const DEFAULT_GRID: IsoGrid = { tileW: 30, tileH: 17, originX: 0, originY: 0 }

export function project(grid: IsoGrid, [x, y, z]: Point3): [number, number] {
  return [grid.originX + (x - y) * grid.tileW, grid.originY + (x + y) * grid.tileH - z]
}

const round = (n: number) => Math.round(n * 100) / 100

/** Строка для атрибута points у <polygon>. */
export function toPoints(grid: IsoGrid, points: readonly Point3[]): string {
  return points.map((p) => project(grid, p).map(round).join(',')).join(' ')
}

export interface Box {
  x: number
  y: number
  /** Высота основания над землёй, px */
  z?: number
  /** Размер по x и y в клетках */
  w: number
  d: number
  /** Высота, px */
  h: number
}

export interface BoxFaces {
  top: string
  left: string
  right: string
}

/** Три видимые грани параллелепипеда: верх, левая (плоскость y+d), правая (плоскость x+w). */
export function boxFaces(grid: IsoGrid, { x, y, z = 0, w, d, h }: Box): BoxFaces {
  const x2 = x + w
  const y2 = y + d
  const top = z + h
  return {
    top: toPoints(grid, [
      [x, y, top],
      [x2, y, top],
      [x2, y2, top],
      [x, y2, top],
    ]),
    left: toPoints(grid, [
      [x, y2, top],
      [x2, y2, top],
      [x2, y2, z],
      [x, y2, z],
    ]),
    right: toPoints(grid, [
      [x2, y, top],
      [x2, y2, top],
      [x2, y2, z],
      [x2, y, z],
    ]),
  }
}

/** Порядок отрисовки: дальние объекты раньше ближних. */
export function depthOf(box: Pick<Box, 'x' | 'y' | 'z'>): number {
  return box.x + box.y + (box.z ?? 0) / 1000
}

export function sortByDepth<T extends Pick<Box, 'x' | 'y' | 'z'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => depthOf(a) - depthOf(b))
}

/** Затемнение грани: доля исходного цвета в смеси с тенью. */
export function shade(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, var(--iso-shade))`
}

/** Детерминированный «случайный» номер 0..mod-1 по строке (высота дома по id задачи). */
export function hashTo(text: string, mod: number): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % mod
}
