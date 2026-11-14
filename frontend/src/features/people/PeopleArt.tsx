import { IsoBox, IsoScene, IsoTile, sortByDepth, type IsoGrid } from '@/shared/iso'
import s from './people.module.css'

const GRID: IsoGrid = { tileW: 20, tileH: 11.5, originX: 110, originY: 30 }

interface Figure {
  x: number
  y: number
  color: string
}

const FIGURES: readonly Figure[] = [
  { x: 0.6, y: 1.9, color: 'var(--brand-green)' },
  { x: 1.9, y: 0.4, color: 'var(--brand-blue)' },
  { x: 3.4, y: 1.9, color: 'var(--brand-red)' },
  { x: 1.9, y: 3.4, color: 'var(--brand-violet)' },
]

const TABLE = { x: 1.6, y: 1.6, w: 1.4, d: 1.4, h: 16 }

/** Изометрическая сцена раздела «Люди»: четыре человечка за общим столом. */
export function PeopleArt({ className }: { className?: string }) {
  const items = sortByDepth([
    ...FIGURES.map((f) => ({ ...f, kind: 'figure' as const })),
    { ...TABLE, color: 'var(--iso-plot)', kind: 'table' as const },
  ])
  return (
    <IsoScene width={220} height={150} grid={GRID} className={className}>
      <IsoTile x={0} y={0} w={4.6} d={4.6} className={s.artGround} />
      {items.map((item) =>
        item.kind === 'table' ? (
          <IsoBox key="table" {...TABLE} color={item.color} />
        ) : (
          <g key={`${item.x}-${item.y}`} className={s.artFigure}>
            <IsoBox x={item.x} y={item.y} w={0.6} d={0.6} h={22} color={item.color} />
            <IsoBox
              x={item.x + 0.1}
              y={item.y + 0.1}
              z={26}
              w={0.4}
              d={0.4}
              h={10}
              color={item.color}
            />
          </g>
        ),
      )}
    </IsoScene>
  )
}
