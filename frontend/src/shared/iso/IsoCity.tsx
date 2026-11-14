import type { CSSProperties, KeyboardEvent } from 'react'
import type { Task } from '@/entities/plan'
import { cn } from '@/shared/lib/cn'
import { hashTo, project, sortByDepth, type IsoGrid, type Point3 } from './iso'
import { IsoBox, IsoPoly, IsoScene } from './IsoScene'
import s from './iso.module.css'

const TILE_W = 30
const TILE_H = 17
const PAD = 14
/** Сторона дома в клетках: между домами остаётся «улица» */
const BLOCK = 0.8
const ROWS = 3
const MIN_COLS = 5
const GROUND_MARGIN = 0.35
const GROUND_DEPTH = 8
const MAX_BUILDING = 72
const FLAG_HEIGHT = 36

const BASE_HEIGHT = 26
const HEIGHT_STEP = 13
const HEIGHT_VARIANTS = 4
const FLOOR_HEIGHT = 13
const WINDOW_HEIGHT = 6

const STAGE_COLOR = ['var(--brand-green)', 'var(--brand-blue)', 'var(--brand-violet)'] as const

interface Lot {
  task: Task
  x: number
  y: number
}

function layout(tasks: readonly Task[]): { lots: Lot[]; cols: number } {
  const perRow = [0, 0, 0]
  const lots = tasks.map((task) => {
    const row = Math.min(Math.max(task.stage, 0), ROWS - 1)
    return { task, x: perRow[row]++, y: row }
  })
  return { lots, cols: Math.max(MIN_COLS, ...perRow) }
}

function doneHeight(task: Task): number {
  return BASE_HEIGHT + hashTo(task.id, HEIGHT_VARIANTS) * HEIGHT_STEP
}

/** Окна на двух видимых стенах: по два на этаж. */
function Windows({ x, y, height }: { x: number; y: number; height: number }) {
  const floors = Math.floor((height - 8) / FLOOR_HEIGHT)
  const x2 = x + BLOCK
  const y2 = y + BLOCK
  const slots = [0.14, 0.46]
  const size = 0.2
  const quads: Point3[][] = []
  for (let floor = 0; floor < floors; floor++) {
    const z1 = 8 + floor * FLOOR_HEIGHT
    const z2 = z1 + WINDOW_HEIGHT
    for (const offset of slots) {
      quads.push([
        [x + offset, y2, z2],
        [x + offset + size, y2, z2],
        [x + offset + size, y2, z1],
        [x + offset, y2, z1],
      ])
      quads.push([
        [x2, y + offset, z2],
        [x2, y + offset + size, z2],
        [x2, y + offset + size, z1],
        [x2, y + offset, z1],
      ])
    }
  }
  return (
    <>
      {quads.map((points, i) => (
        <IsoPoly key={i} points={points} className={s.window} />
      ))}
    </>
  )
}

function Flag({ grid, x, y, z }: { grid: IsoGrid; x: number; y: number; z: number }) {
  const [px, py] = project(grid, [x + BLOCK / 2, y + BLOCK / 2, z])
  const top = py - FLAG_HEIGHT
  return (
    <g>
      <path d={`M${px} ${py}V${top}`} className={s.ink} />
      <polygon
        points={`${px},${top} ${px + 18},${top + 6} ${px},${top + 13}`}
        className={s.flag}
        style={{ fill: 'var(--brand-red)' }}
      />
    </g>
  )
}

function Building({ lot, isCurrent, grid }: { lot: Lot; isCurrent: boolean; grid: IsoGrid }) {
  const { task, x, y } = lot
  const stageColor = STAGE_COLOR[y]
  const base = { x, y, w: BLOCK, d: BLOCK }

  if (task.status === 'done') {
    const height = doneHeight(task)
    return (
      <>
        <IsoBox {...base} h={height} color={stageColor} />
        <Windows x={x} y={y} height={height} />
        {hashTo(task.id, 3) === 0 && (
          <IsoBox x={x + 0.2} y={y + 0.2} z={height} w={0.4} d={0.4} h={7} color={stageColor} />
        )}
      </>
    )
  }
  if (isCurrent) {
    return (
      <>
        <IsoBox {...base} h={10} color="var(--brand-yellow)" />
        <Flag grid={grid} x={x} y={y} z={10} />
      </>
    )
  }
  if (task.status === 'blocked') {
    return (
      <>
        <IsoBox {...base} h={5} color="var(--iso-plot)" />
        <IsoBox x={x + 0.1} y={y + 0.3} z={5} w={0.6} d={0.2} h={9} color="var(--brand-red)" />
      </>
    )
  }
  if (task.status === 'in_progress') {
    return (
      <>
        <IsoBox {...base} h={5} color="var(--iso-plot)" />
        <IsoBox
          x={x + 0.1}
          y={y + 0.1}
          z={5}
          w={0.6}
          d={0.6}
          h={10}
          color={`color-mix(in srgb, ${stageColor} 55%, var(--iso-plot))`}
        />
      </>
    )
  }
  return <IsoBox {...base} h={4} color="var(--iso-plot)" />
}

type IsoCityProps = {
  tasks: readonly Task[]
  /** id задачи «следующий шаг»: на ней стоит флажок */
  currentId?: string | null
  onSelect?: (task: Task) => void
  label: string
  className?: string
}

/**
 * Город прогресса: каждая задача - участок. Закрытая задача становится домом,
 * цвет дома - этап (зелёный, синий, фиолетовый), на следующем шаге стоит флажок.
 */
export function IsoCity({ tasks, currentId, onSelect, label, className }: IsoCityProps) {
  const { lots, cols } = layout(tasks)
  const span = cols + ROWS + GROUND_MARGIN * 2
  const grid: IsoGrid = {
    tileW: TILE_W,
    tileH: TILE_H,
    originX: PAD + (ROWS + GROUND_MARGIN) * TILE_W,
    originY: PAD + MAX_BUILDING + GROUND_MARGIN * 2 * TILE_H,
  }
  const width = span * TILE_W + PAD * 2
  const height = grid.originY + (cols + ROWS + GROUND_MARGIN) * TILE_H + GROUND_DEPTH + PAD

  const handleKey = (event: KeyboardEvent, task: Task) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(task)
    }
  }

  return (
    <IsoScene width={width} height={height} grid={grid} label={label} className={className}>
      <IsoBox
        x={-GROUND_MARGIN}
        y={-GROUND_MARGIN}
        z={-GROUND_DEPTH}
        w={cols - (1 - BLOCK) + GROUND_MARGIN * 2}
        d={ROWS - (1 - BLOCK) + GROUND_MARGIN * 2}
        h={GROUND_DEPTH}
        color="var(--iso-ground)"
      />
      {sortByDepth(lots).map((lot, order) => (
        <g
          key={`${lot.task.id}-${lot.task.status}`}
          className={cn(s.building, onSelect && s.clickable)}
          style={{ '--i': order } as CSSProperties}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={onSelect ? lot.task.title : undefined}
          onClick={onSelect ? () => onSelect(lot.task) : undefined}
          onKeyDown={onSelect ? (event) => handleKey(event, lot.task) : undefined}
        >
          <title>{lot.task.title}</title>
          <Building lot={lot} isCurrent={lot.task.id === currentId} grid={grid} />
        </g>
      ))}
    </IsoScene>
  )
}
