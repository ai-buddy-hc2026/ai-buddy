import { IsoBox, IsoScene, type IsoGrid } from '@/shared/iso'
import { useT } from '@/shared/lib/i18n'
import { Icon } from '@/shared/ui'
import { trackColorVar } from './catalog'
import type { BadgeInfo } from './logic'
import s from './tracks.module.css'

const BADGE_GRID: IsoGrid = { tileW: 14, tileH: 8, originX: 36, originY: 30 }

type Props = { badge: BadgeInfo }

/** Бейдж: изометрическая медаль на подставке. Не получен - серый и с замком. */
export function TrackBadge({ badge }: Props) {
  const t = useT()
  const color = badge.isEarned ? trackColorVar(badge.color) : 'var(--iso-plot)'
  const title = t(badge.title.ru, badge.title.en)
  return (
    <li className={s.badge} data-earned={badge.isEarned}>
      <IsoScene width={72} height={64} grid={BADGE_GRID} className={s.badgeArt}>
        <IsoBox x={0.2} y={0.2} w={1.6} d={1.6} h={6} color="var(--iso-ink)" />
        <IsoBox x={0.6} y={0.6} z={6} w={0.8} d={0.8} h={8} color={color} />
        <IsoBox x={0.3} y={0.3} z={14} w={1.4} d={1.4} h={14} color={color} />
      </IsoScene>
      <span className={s.badgeTitle}>{title}</span>
      <span className={s.badgeState}>
        {badge.isEarned ? (
          <>
            <Icon name="check" size={14} />
            {t('Получен', 'Earned')}
          </>
        ) : (
          <>
            <Icon name="lock" size={14} />
            {t('Ещё нет', 'Not yet')}
          </>
        )}
      </span>
    </li>
  )
}
