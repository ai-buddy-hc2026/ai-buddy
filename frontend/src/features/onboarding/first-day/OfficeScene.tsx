import { IsoBox, IsoScene, IsoTile, project, type IsoGrid, type Point3 } from '@/shared/iso'
import s from './first-day.module.css'

const GRID: IsoGrid = { tileW: 22, tileH: 12.5, originX: 150, originY: 118 }

/** Точки маршрута 1-4 в координатах сетки: вход, ресепшен, лифты, встреча */
const MARKS: readonly Point3[] = [
  [4, 4.6, 34],
  [3.9, 2.5, 46],
  [6.1, 1.4, 74],
  [6.6, 2.9, 40],
]

type Props = { label: string; activeStep: number | null }

/** Изометрическая сцена входа в офис: улица, дорожка, лобби, ресепшен, лифты и метки шагов. */
export function OfficeScene({ label, activeStep }: Props) {
  return (
    <IsoScene width={330} height={300} grid={GRID} label={label} className={s.scene}>
      <IsoTile x={0} y={0} w={8} d={6} color="var(--iso-ground)" />
      <IsoTile x={0} y={5} w={8} d={1} color="var(--iso-ground-edge)" />
      <IsoTile x={3.6} y={3.5} w={0.8} d={1.5} color="var(--brand-yellow)" />
      <IsoBox x={1} y={0} w={3.2} d={0.8} h={110} color="var(--iso-plot)" />
      <IsoBox x={1} y={0.8} w={6} d={2.7} h={4} color="var(--iso-plot)" />
      <IsoBox x={1.2} y={0.6} z={60} w={2.8} d={0.25} h={8} color="var(--brand-blue)" />
      <IsoBox x={5.6} y={1} z={4} w={1} d={0.8} h={48} color="var(--brand-violet)" />
      <IsoBox x={3.2} y={2.2} z={4} w={1.4} d={0.5} h={12} color="var(--brand-green)" />
      <IsoBox x={6.3} y={2.6} z={4} w={0.3} d={0.3} h={22} color="var(--iso-ink)" />
      <IsoBox x={3.6} y={3.35} z={4} w={0.8} d={0.15} h={22} color="var(--brand-red)" />
      {MARKS.map((point, i) => {
        const [cx, cy] = project(GRID, point)
        const isActive = activeStep === i
        return (
          <g
            key={i}
            className={isActive ? s.markActive : s.mark}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          >
            <circle cx={cx} cy={cy} r={11} className={s.markDot} />
            <text
              x={cx}
              y={cy}
              className={s.markText}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {i + 1}
            </text>
          </g>
        )
      })}
    </IsoScene>
  )
}
