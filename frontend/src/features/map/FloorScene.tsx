import type { KeyboardEvent } from 'react'
import { FLOOR, PLACES, type Place } from '@/entities/places'
import { IsoBox, IsoScene, IsoTile, sortByDepth, toPoints, useIsoGrid } from '@/shared/iso'
import { cn } from '@/shared/lib/cn'
import {
  ROUTE_Z,
  SCENE_GRID,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  SLAB_DEPTH,
  TYPE_META,
  corridorRects,
  placeFootprint,
  type PinTone,
} from './floorLayout'
import { matchesFilter, type PlaceFilter } from './mapLogic'
import { MapPin } from './MapPin'
import s from './FloorScene.module.css'

export type ScenePin = { placeId: string; label: string; tone: PinTone }

type Props = {
  label: string
  selectedId: string | null
  /** Линия маршрута в координатах сетки */
  path: ReadonlyArray<readonly [number, number]> | null
  filter: PlaceFilter
  pins: readonly ScenePin[]
  onSelect: (placeId: string) => void
}

const SELECT_RING = 0.12

function RouteLine({ path }: { path: ReadonlyArray<readonly [number, number]> }) {
  const grid = useIsoGrid()
  const points = toPoints(
    grid,
    path.map(([x, y]) => [x, y, ROUTE_Z] as const),
  )
  return (
    <g className={s.route}>
      <polyline points={points} className={s.routeCasing} />
      <polyline points={points} className={s.routeLine} />
    </g>
  )
}

function PlaceBox({
  place,
  isSelected,
  isDimmed,
  onSelect,
}: {
  place: Place
  isSelected: boolean
  isDimmed: boolean
  onSelect: (placeId: string) => void
}) {
  const meta = TYPE_META[place.type]
  const foot = placeFootprint(place)
  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(place.id)
    }
  }
  return (
    <g
      className={cn(s.place, isDimmed && s.dimmed, isSelected && s.selected)}
      role="button"
      tabIndex={0}
      aria-label={place.name}
      aria-pressed={isSelected}
      onClick={() => onSelect(place.id)}
      onKeyDown={handleKey}
    >
      <title>{place.name}</title>
      {isSelected && (
        <IsoTile
          x={foot.x - SELECT_RING}
          y={foot.y - SELECT_RING}
          w={foot.w + SELECT_RING * 2}
          d={foot.d + SELECT_RING * 2}
          className={s.ring}
        />
      )}
      <IsoBox {...foot} h={meta.height} color={meta.color} />
    </g>
  )
}

/** Изометрический план этажа: пол, коридоры, маршрут, кликабельные места и метки. */
export function FloorScene({ label, selectedId, path, filter, pins, onSelect }: Props) {
  return (
    <IsoScene
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      grid={SCENE_GRID}
      label={label}
      role="group"
      className={s.scene}
    >
      <IsoBox
        x={0}
        y={0}
        z={-SLAB_DEPTH}
        w={FLOOR.cols}
        d={FLOOR.rows}
        h={SLAB_DEPTH}
        color="var(--iso-ground)"
      />
      {corridorRects().map((rect, i) => (
        <IsoTile key={i} {...rect} className={s.corridor} />
      ))}
      {path && <RouteLine path={path} />}
      {sortByDepth(PLACES).map((place) => (
        <PlaceBox
          key={place.id}
          place={place}
          isSelected={place.id === selectedId}
          isDimmed={!matchesFilter(place, filter)}
          onSelect={onSelect}
        />
      ))}
      {pins.map((pin) => {
        const place = PLACES.find((p) => p.id === pin.placeId)
        return place ? (
          <MapPin
            key={pin.placeId}
            place={place}
            height={TYPE_META[place.type].height}
            label={pin.label}
            tone={pin.tone}
          />
        ) : null
      })}
    </IsoScene>
  )
}
