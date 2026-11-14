import { useSettings } from '@/entities/settings'
import { formatShort } from '@/shared/lib/date'
import { useT } from '@/shared/lib/i18n'
import { niceMax, type DayStat } from './logic'
import s from './analytics.module.css'

type Props = {
  days: readonly DayStat[]
}

const WIDTH = 480
const HEIGHT = 220
const PAD_LEFT = 28
const PAD_BOTTOM = 28
const PAD_TOP = 12
const BAR_GAP = 4
const GRID_LINES = 3

/** Простой SVG-график без библиотек: всего вопросов и закрыто ботом по дням. */
export function BarChart({ days }: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const max = niceMax(Math.max(0, ...days.map((d) => d.asked)))
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const slot = (WIDTH - PAD_LEFT) / Math.max(1, days.length)
  const barW = Math.min(36, (slot - BAR_GAP * 3) / 2)
  const y = (value: number) => PAD_TOP + plotH - (value / max) * plotH
  const summary = days
    .map((d) => `${formatShort(d.date, lang)}: ${d.selfServed} ${t('из', 'of')} ${d.asked}`)
    .join('; ')

  return (
    <figure className={s.chart}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${t('Вопросы по дням, закрыто без наставника', 'Questions per day, closed without mentor')}: ${summary}`}
      >
        {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
          const value = (max / GRID_LINES) * i
          return (
            <g key={i}>
              <line x1={PAD_LEFT} x2={WIDTH} y1={y(value)} y2={y(value)} className={s.gridLine} />
              <text x={PAD_LEFT - 6} y={y(value) + 4} textAnchor="end" className={s.axis}>
                {Math.round(value)}
              </text>
            </g>
          )
        })}
        {days.map((d, i) => {
          const x = PAD_LEFT + slot * i + (slot - barW * 2 - BAR_GAP) / 2
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y(d.asked)}
                width={barW}
                height={y(0) - y(d.asked)}
                rx={6}
                className={s.barAsked}
              />
              <rect
                x={x + barW + BAR_GAP}
                y={y(d.selfServed)}
                width={barW}
                height={y(0) - y(d.selfServed)}
                rx={6}
                className={s.barSelf}
              />
              <text
                x={x + barW + BAR_GAP / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className={s.axis}
              >
                {formatShort(d.date, lang)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className={s.legend}>
        <span>
          <i className={s.swatchAsked} aria-hidden /> {t('Всего вопросов', 'All questions')}
        </span>
        <span>
          <i className={s.swatchSelf} aria-hidden />{' '}
          {t('Закрыто без наставника', 'Closed without mentor')}
        </span>
      </figcaption>
    </figure>
  )
}
