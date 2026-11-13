import { Link } from '@tanstack/react-router'
import type { Employee } from '@/entities/employees'
import { FLOOR, type Place } from '@/entities/places'
import { useSettings } from '@/entities/settings'
import { useT } from '@/shared/lib/i18n'
import { Avatar, Badge, Button, Chip, ChipRow, Icon, IconButton, Note } from '@/shared/ui'
import { TYPE_META } from './floorLayout'
import {
  askBuddyQuestion,
  deskOwner,
  distanceBetween,
  routeSteps,
  walkMinutes,
  type RoutePlan,
  type RouteStart,
} from './mapLogic'
import s from './MapPage.module.css'

type Props = {
  place: Place
  viewer: Employee
  /** Маршрут до этого места, если он построен */
  plan: RoutePlan | null
  start: RouteStart
  onStartChange: (start: RouteStart) => void
  onRoute: () => void
  onClearRoute: () => void
  /** Есть - показываем кнопку «назад к списку» (десктоп) */
  onClose?: () => void
  /** В bottom sheet заголовок рисует Dialog */
  isInSheet?: boolean
}

function DistanceNote({ place, viewer }: { place: Place; viewer: Employee }) {
  const t = useT()
  if (!viewer.deskId || viewer.deskId === place.id) return null
  const meters = distanceBetween(viewer.deskId, place.id)
  if (meters === null) return null
  const text =
    meters === 0
      ? t('рядом с тобой', 'right next to you')
      : t(`в ${meters} м от твоего стола`, `${meters} m from your desk`)
  return <span> · {text}</span>
}

function Owner({ place, viewer }: { place: Place; viewer: Employee }) {
  const t = useT()
  const owner = deskOwner(place, viewer)
  if (!owner) return null
  const { employee } = owner
  if (owner.kind === 'self') {
    return <Note tone="success" icon="pin" title={t('Это твой стол', 'This is your desk')} />
  }
  return (
    <div className={s.owner}>
      <Avatar
        name={employee.name}
        color={employee.color}
        size={48}
        isSquare
        isOnline={employee.online}
      />
      <div className={s.ownerText}>
        <b>{employee.name}</b>
        <span className="t-s t-muted">{employee.role}</span>
        {owner.kind === 'teammate' && employee.askAbout && (
          <span className="t-s">{employee.askAbout}</span>
        )}
      </div>
      {owner.kind === 'teammate' && (
        <Link to="/chats" search={{ c: employee.id }} className={s.linkBtn}>
          <Icon name="chat" size={18} />
          {t('Написать', 'Message')}
        </Link>
      )}
    </div>
  )
}

function RouteBlock({
  plan,
  viewer,
  start,
  onStartChange,
}: Pick<Props, 'viewer' | 'start' | 'onStartChange'> & { plan: RoutePlan }) {
  const t = useT()
  const steps = routeSteps(plan, t)
  return (
    <section className={s.routeBlock} aria-live="polite" aria-label={t('Маршрут', 'Route')}>
      {viewer.deskId && (
        <ChipRow>
          <Chip isSelected={start === 'lift'} onClick={() => onStartChange('lift')}>
            {t('От лифта', 'From the lift')}
          </Chip>
          <Chip isSelected={start === 'desk'} onClick={() => onStartChange('desk')}>
            {t('От моего стола', 'From my desk')}
          </Chip>
        </ChipRow>
      )}
      <ol className={s.steps}>
        {steps.map((step, i) => (
          <li key={`${i}-${step}`}>
            <span className={s.stepNum} aria-hidden>
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="t-s t-muted">
        {t(
          `Около ${plan.route.length} м, ${walkMinutes(plan.route.length)} мин пешком`,
          `About ${plan.route.length} m, ${walkMinutes(plan.route.length)} min walk`,
        )}
      </p>
    </section>
  )
}

/** Карточка места: что это, чей стол, маршрут и вопрос buddy. */
export function MapPanel({
  place,
  viewer,
  plan,
  start,
  onStartChange,
  onRoute,
  onClearRoute,
  onClose,
  isInSheet = false,
}: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const meta = TYPE_META[place.type]

  return (
    <div className={s.panel}>
      {onClose && (
        <Button variant="ghost" size="s" icon="arrowLeft" onClick={onClose} className={s.back}>
          {t('Все места', 'All places')}
        </Button>
      )}
      <header className={s.panelHead}>
        <Badge icon={meta.icon}>{meta.label[lang]}</Badge>
        {!isInSheet && <h2 className={s.panelTitle}>{place.name}</h2>}
        <p className="t-s t-muted">
          {t(`${FLOOR.number} этаж`, `Floor ${FLOOR.number}`)}
          <DistanceNote place={place} viewer={viewer} />
        </p>
      </header>

      <Owner place={place} viewer={viewer} />

      {plan ? (
        <RouteBlock plan={plan} viewer={viewer} start={start} onStartChange={onStartChange} />
      ) : (
        <Button variant="primary" icon="route" onClick={onRoute} isBlock>
          {t('Как дойти', 'Show the way')}
        </Button>
      )}

      <div className={s.panelFoot}>
        <Link
          to="/chats"
          search={{ c: 'buddy', q: askBuddyQuestion(place, t) }}
          className={s.linkBtn}
        >
          <Icon name="sparkle" size={18} />
          {t('Спросить buddy', 'Ask buddy')}
        </Link>
        {plan && (
          <IconButton
            icon="close"
            label={t('Убрать маршрут', 'Clear route')}
            variant="secondary"
            onClick={onClearRoute}
          />
        )}
      </div>
    </div>
  )
}
