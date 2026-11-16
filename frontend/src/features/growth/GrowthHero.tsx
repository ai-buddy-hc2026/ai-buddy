import { useBrag } from '@/entities/brag'
import { countDone, usePlan } from '@/entities/plan'
import { IsoBox, IsoScene, sortByDepth, type IsoGrid } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import { Card, Eyebrow, Skeleton } from '@/shared/ui'
import { useFeedbackRequests, useMergeRequests } from './data'
import s from './growth.module.css'

const STAIRS_GRID: IsoGrid = { tileW: 26, tileH: 15, originX: 96, originY: 70 }
const STEP_COLORS = [
  'var(--brand-green)',
  'var(--brand-blue)',
  'var(--brand-violet)',
  'var(--brand-yellow)',
]
const STEP_HEIGHT = 11

const STEPS = STEP_COLORS.map((color, i) => ({
  x: i * 1.1,
  y: 0,
  w: 1,
  d: 1.8,
  h: STEP_HEIGHT * (i + 1),
  color,
}))
const FLAG = [
  { x: 3.7, y: 0.8, z: STEP_HEIGHT * 4, w: 0.12, d: 0.12, h: 30, color: 'var(--iso-ink)' },
  { x: 3.82, y: 0.8, z: STEP_HEIGHT * 4 + 20, w: 0.7, d: 0.1, h: 10, color: 'var(--brand-red)' },
]

/** Лестница роста: каждая ступень - этап стажировки, флажок - экватор. */
function Stairs() {
  return (
    <IsoScene width={200} height={150} grid={STAIRS_GRID} className={s.heroArt}>
      {sortByDepth([...STEPS, ...FLAG]).map((box, i) => (
        <IsoBox key={i} {...box} />
      ))}
    </IsoScene>
  )
}

export function GrowthHero() {
  const t = useT()
  const plan = usePlan()
  const brag = useBrag()
  const mrs = useMergeRequests()
  const feedback = useFeedbackRequests()
  const isLoading = plan.isPending || brag.isPending || mrs.isPending || feedback.isPending

  const stats = [
    { value: countDone(plan.data?.tasks ?? []), label: t('закрытых задач', 'tasks done') },
    { value: mrs.data?.length ?? 0, label: t('MR в GitLab', 'MRs in GitLab') },
    {
      value: (feedback.data ?? []).filter((r) => r.status === 'answered').length,
      label: t('отзывов', 'reviews'),
    },
    { value: brag.data?.length ?? 0, label: t('в достижениях', 'achievements') },
  ]

  return (
    <Card className={s.hero} index={0}>
      <div className={s.heroText}>
        <Eyebrow>{t('К экватору', 'Towards the midpoint')}</Eyebrow>
        <h2 className={s.heroTitle}>
          {t('Buddy сам собирает твои достижения', 'Buddy collects your wins for you')}
        </h2>
        {isLoading ? (
          <Skeleton height={56} width={320} />
        ) : (
          <dl className={s.stats}>
            {stats.map((stat) => (
              <div key={stat.label} className={s.stat}>
                <dt>{stat.label}</dt>
                <dd className="t-num">{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <Stairs />
    </Card>
  )
}
