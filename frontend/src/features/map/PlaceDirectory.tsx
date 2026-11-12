import { Link } from '@tanstack/react-router'
import { getEmployee } from '@/entities/employees'
import type { Place } from '@/entities/places'
import { useSettings } from '@/entities/settings'
import { IsoArt } from '@/shared/iso'
import { cn } from '@/shared/lib/cn'
import { useT } from '@/shared/lib/i18n'
import { Avatar, Chip, ChipRow, EmptyState, Icon, Input, Note, Row } from '@/shared/ui'
import { TYPE_META, TYPE_ORDER } from './floorLayout'
import { remoteMatches, searchPlaces, type PlaceFilter } from './mapLogic'
import s from './MapPage.module.css'

type Props = {
  query: string
  onQuery: (query: string) => void
  filter: PlaceFilter
  onFilter: (filter: PlaceFilter) => void
  selectedId: string | null
  onPick: (placeId: string) => void
}

function PlaceRow({
  place,
  isSelected,
  onPick,
}: {
  place: Place
  isSelected: boolean
  onPick: (id: string) => void
}) {
  const lang = useSettings((state) => state.lang)
  const meta = TYPE_META[place.type]
  const owner = place.employeeId ? getEmployee(place.employeeId) : undefined
  return (
    <li>
      <Row
        className={cn(s.placeRow, isSelected && s.placeRowActive)}
        onClick={() => onPick(place.id)}
        leading={
          <span className={s.typeIcon} style={{ background: meta.color }}>
            <Icon name={meta.icon} size={20} />
          </span>
        }
        title={place.name}
        subtitle={owner ? `${owner.short} · ${owner.role}` : meta.label[lang]}
        trailing={<Icon name="chevronRight" size={18} />}
      />
    </li>
  )
}

/** Справочник мест: поиск, фильтры по типу, похожие варианты и люди на удалёнке. */
export function PlaceDirectory({ query, onQuery, filter, onFilter, selectedId, onPick }: Props) {
  const t = useT()
  const lang = useSettings((state) => state.lang)
  const result = searchPlaces(query, filter)
  const remote = remoteMatches(query)
  const isEmpty = result.places.length === 0 && remote.length === 0

  return (
    <div className={s.directory}>
      <h2 className={s.asideTitle}>{t('Места на этаже', 'Places on the floor')}</h2>
      <Input
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={t('Байкал, кухня, Илья...', 'Baikal, kitchen, Ilya...')}
        aria-label={t('Поиск места', 'Search a place')}
      />
      <ChipRow role="group" aria-label={t('Тип места', 'Place type')}>
        <Chip isSelected={filter === 'all'} onClick={() => onFilter('all')}>
          {t('Все', 'All')}
        </Chip>
        {TYPE_ORDER.map((type) => (
          <Chip
            key={type}
            icon={TYPE_META[type].icon}
            isSelected={filter === type}
            onClick={() => onFilter(type)}
          >
            {TYPE_META[type].label[lang]}
          </Chip>
        ))}
      </ChipRow>

      <p className="visually-hidden" aria-live="polite">
        {t(`Найдено: ${result.places.length}`, `Found: ${result.places.length}`)}
      </p>

      {result.isFuzzy && (
        <Note title={t('Точно такого нет. Может, ты про это?', 'No exact match. Did you mean?')} />
      )}

      {isEmpty ? (
        <EmptyState
          art={<IsoArt name="plot" />}
          title={t('Не нашёл такое место', 'No such place')}
          text={t(
            'Спроси buddy, он подскажет или позовёт человека',
            'Ask buddy, it will help or find a person',
          )}
          action={
            <Link
              to="/chats"
              search={{ c: 'buddy', q: t(`Где ${query.trim()}?`, `Where is ${query.trim()}?`) }}
              className={s.linkBtn}
            >
              <Icon name="sparkle" size={18} />
              {t('Спросить buddy', 'Ask buddy')}
            </Link>
          }
        />
      ) : (
        <ul className={s.list}>
          {result.places.map((place) => (
            <PlaceRow
              key={place.id}
              place={place}
              isSelected={place.id === selectedId}
              onPick={onPick}
            />
          ))}
          {remote.map((employee) => (
            <li key={employee.id}>
              <Row
                leading={<Avatar name={employee.name} color={employee.color} size={40} isSquare />}
                title={employee.name}
                subtitle={`${employee.role} · ${t('Работает удалённо', 'Works remotely')}`}
                trailing={
                  <Link to="/chats" search={{ c: employee.id }} className={s.linkBtn}>
                    {t('Написать', 'Message')}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
