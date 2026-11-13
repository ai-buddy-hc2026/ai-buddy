import { useCallback, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import { FLOOR, getPlace } from '@/entities/places'
import { DEMO, useUser } from '@/entities/session'
import { useSettings } from '@/entities/settings'
import { useT } from '@/shared/lib/i18n'
import { Card, Chip, ChipRow, Dialog, Eyebrow, Icon, Note } from '@/shared/ui'
import { FloorScene, type ScenePin } from './FloorScene'
import { TYPE_META, TYPE_ORDER } from './floorLayout'
import { MapPanel } from './MapPanel'
import {
  planRoute,
  resolveTarget,
  routePath,
  routeStartId,
  type PlaceFilter,
  type RouteStart,
} from './mapLogic'
import { PlaceDirectory } from './PlaceDirectory'
import { useIsPhone } from './useIsPhone'
import s from './MapPage.module.css'

type MapSearch = { to?: string; id?: string }

function Legend() {
  const lang = useSettings((state) => state.lang)
  return (
    <ul className={s.legend}>
      {TYPE_ORDER.map((type) => (
        <li key={type}>
          <i style={{ background: TYPE_META[type].color }} />
          {TYPE_META[type].label[lang]}
        </li>
      ))}
    </ul>
  )
}

/** Карта офиса (идеи 1 и 2): план этажа, справочник мест и маршрут по ?to=<placeId>. */
export function MapPage() {
  const t = useT()
  const user = useUser()
  const isPhone = useIsPhone()
  const navigate = useNavigate()
  const search: MapSearch & { q?: string } = useSearch({ strict: false })
  const [query, setQuery] = useState(() => search.q ?? '')
  const [filter, setFilter] = useState<PlaceFilter>('all')
  const [start, setStart] = useState<RouteStart>('lift')

  const viewer = user.employee
  const target = resolveTarget(search.to)
  const selected = getPlace(search.id ?? '') ?? target.place
  const plan = target.place ? planRoute(target.place.id, routeStartId(start, viewer.deskId)) : null
  const selectedPlan = plan && selected && plan.to.id === selected.id ? plan : null

  const go = useCallback(
    (next: MapSearch) => void navigate({ to: '/map', search: next, replace: true }),
    [navigate],
  )
  const select = (id: string) => go({ to: search.to, id })
  const routeTo = (id: string) => go({ to: id, id })
  const clearRoute = () => go({ id: search.id })
  const closePanel = useCallback(
    () => go(!search.id || search.id === search.to ? {} : { to: search.to }),
    [go, search.id, search.to],
  )

  const mentorDesk = user.role === 'intern' ? getEmployee(DEMO.mentorId)?.deskId : null
  const pins: ScenePin[] = [
    ...(viewer.deskId
      ? [{ placeId: viewer.deskId, label: t('Ты здесь', 'You are here'), tone: 'me' as const }]
      : []),
    ...(mentorDesk
      ? [{ placeId: mentorDesk, label: t('Наставник', 'Mentor'), tone: 'mentor' as const }]
      : []),
  ]
  const targetPin = plan && !pins.some((pin) => pin.placeId === plan.to.id)
  const scenePins = targetPin
    ? [...pins, { placeId: plan.to.id, label: t('Сюда', 'Here'), tone: 'target' as const }]
    : pins

  const panel = selected ? (
    <MapPanel
      place={selected}
      viewer={viewer}
      plan={selectedPlan}
      start={start}
      onStartChange={setStart}
      onRoute={() => routeTo(selected.id)}
      onClearRoute={clearRoute}
      onClose={isPhone ? undefined : closePanel}
      isInSheet={isPhone}
    />
  ) : null

  return (
    <div className={s.layout}>
      <Card className={s.sceneCard} index={0}>
        <header className={s.sceneHead}>
          <div>
            <Eyebrow>{t(`${FLOOR.number} этаж`, `Floor ${FLOOR.number}`)}</Eyebrow>
            <h1 className={s.title}>{t('Карта офиса', 'Office map')}</h1>
          </div>
          <Legend />
        </header>

        {search.to && !target.place && (
          <Note
            tone="warning"
            title={t(`Не нашёл «${search.to}»`, `Could not find "${search.to}"`)}
          >
            {target.similar.length > 0 ? (
              <span className={s.similar}>
                {t('Может, ты про:', 'Did you mean:')}
                <ChipRow isWrap>
                  {target.similar.map((place) => (
                    <Chip key={place.id} onClick={() => routeTo(place.id)}>
                      {place.name}
                    </Chip>
                  ))}
                </ChipRow>
              </span>
            ) : (
              <Link
                to="/chats"
                search={{ c: 'buddy', q: t(`Где ${search.to}?`, `Where is ${search.to}?`) }}
                className={s.inlineLink}
              >
                {t('Спросить buddy', 'Ask buddy')}
              </Link>
            )}
          </Note>
        )}

        <div className={s.scene}>
          <FloorScene
            label={t(
              'План этажа. Нажми на место, чтобы узнать о нём',
              'Floor plan. Tap a place to learn more',
            )}
            selectedId={selected?.id ?? null}
            path={plan ? routePath(plan) : null}
            filter={filter}
            pins={scenePins}
            onSelect={select}
          />
        </div>

        {plan && (
          <p className={s.routeSummary} aria-live="polite">
            <Icon name="route" size={20} />
            {t(
              `Маршрут до места «${plan.to.name}»: ${plan.route.length} м`,
              `Route to ${plan.to.name}: ${plan.route.length} m`,
            )}
          </p>
        )}
      </Card>

      <Card as="aside" className={s.aside} index={1} pad="s">
        <div className="scroll-area">
          {panel && !isPhone ? (
            panel
          ) : (
            <PlaceDirectory
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
              selectedId={selected?.id ?? null}
              onPick={select}
            />
          )}
        </div>
      </Card>

      {isPhone && (
        <Dialog
          isOpen={Boolean(selected)}
          onClose={closePanel}
          title={selected?.name ?? ''}
          closeLabel={t('Закрыть', 'Close')}
        >
          {panel}
        </Dialog>
      )}
    </div>
  )
}
