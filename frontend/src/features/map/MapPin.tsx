import type { Place } from '@/entities/places'
import { project, useIsoGrid } from '@/shared/iso'
import { cn } from '@/shared/lib/cn'
import { PIN_PILL_H, PIN_STEM, pinWidth, type PinTone } from './floorLayout'
import s from './FloorScene.module.css'

type Props = {
  place: Place
  /** Высота объекта, px: метка стоит на его крыше */
  height: number
  label: string
  tone: PinTone
}

/** Метка над объектом плана: «Ты здесь», «Наставник», цель маршрута. */
export function MapPin({ place, height, label, tone }: Props) {
  const grid = useIsoGrid()
  const [px, py] = project(grid, [place.x + place.w / 2, place.y + place.d / 2, height])
  const stem = PIN_STEM[tone]
  const width = pinWidth(label)
  const top = py - stem - PIN_PILL_H

  return (
    <g className={cn(s.pin, s[`pin-${tone}`])} aria-hidden>
      <path d={`M${px} ${py}V${py - stem}`} className={s.pinStem} />
      <circle cx={px} cy={py} r={4} className={s.pinDot} />
      <g className={s.pinHead}>
        <rect
          x={px - width / 2}
          y={top}
          width={width}
          height={PIN_PILL_H}
          rx={PIN_PILL_H / 2}
          className={s.pinPill}
        />
        <text
          x={px}
          y={top + PIN_PILL_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className={s.pinText}
        >
          {label}
        </text>
      </g>
    </g>
  )
}
