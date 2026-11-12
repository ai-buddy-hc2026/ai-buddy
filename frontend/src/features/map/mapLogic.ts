import { EMPLOYEES, getEmployee, type Employee } from '@/entities/employees'
import {
  FLOOR,
  PLACES,
  findPlace,
  getPlace,
  routeToPlace,
  type Place,
  type PlaceType,
  type Route,
} from '@/entities/places'
import type { Translate } from '@/shared/lib/i18n'

export type PlaceFilter = PlaceType | 'all'
export type RouteStart = 'lift' | 'desk'

/** Средний шаг по офису, метров в минуту */
const WALK_M_PER_MIN = 70
const LIFT_ID = 'lift'

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function searchKeys(place: Place): string[] {
  const owner = place.employeeId ? getEmployee(place.employeeId) : undefined
  const ownerKeys = owner ? [owner.name, owner.short, owner.role] : []
  return [place.name, ...place.aliases, ...ownerKeys].map(normalize)
}

export function matchesFilter(place: Place, filter: PlaceFilter): boolean {
  return filter === 'all' || place.type === filter
}

export interface PlaceSearch {
  places: Place[]
  /** true - точного совпадения нет, это похожие варианты */
  isFuzzy: boolean
}

/**
 * Справочник мест: подстрока по названию, синонимам и владельцу стола,
 * затем find_place (фраза «где байкал?»), затем до 3 похожих вариантов.
 */
export function searchPlaces(query: string, filter: PlaceFilter = 'all'): PlaceSearch {
  const text = normalize(query)
  const pool = PLACES.filter((place) => matchesFilter(place, filter))
  if (!text) return { places: pool, isFuzzy: false }

  const direct = pool.filter((place) => searchKeys(place).some((key) => key.includes(text)))
  if (direct.length > 0) return { places: direct, isFuzzy: false }

  const { match, similar } = findPlace(query)
  if (match) return { places: matchesFilter(match, filter) ? [match] : [], isFuzzy: false }
  const fuzzy = similar.filter((place) => matchesFilter(place, filter))
  return { places: fuzzy, isFuzzy: fuzzy.length > 0 }
}

/** Люди без стола, подходящие под запрос: для них пишем «Работает удалённо». */
export function remoteMatches(query: string): Employee[] {
  const text = normalize(query)
  if (text.length < 2) return []
  return EMPLOYEES.filter(
    (employee) =>
      employee.deskId === null &&
      [employee.name, employee.short].some((key) => normalize(key).includes(text)),
  )
}

export type DeskOwner =
  | { kind: 'self'; employee: Employee }
  | { kind: 'teammate'; employee: Employee }
  /** Другая команда: показываем только имя и роль */
  | { kind: 'other'; employee: Employee }

export function deskOwner(place: Place, viewer: Employee): DeskOwner | null {
  if (place.type !== 'desk' || !place.employeeId) return null
  const employee = getEmployee(place.employeeId)
  if (!employee) return null
  if (employee.id === viewer.id) return { kind: 'self', employee }
  return { kind: employee.teamId === viewer.teamId ? 'teammate' : 'other', employee }
}

export interface TargetLookup {
  place: Place | null
  /** Если точка не нашлась: «Может, ты про...» */
  similar: Place[]
}

/** Разбор ?to=: id точки или текст из чата. */
export function resolveTarget(to: string | undefined): TargetLookup {
  if (!to) return { place: null, similar: [] }
  const exact = getPlace(to)
  if (exact) return { place: exact, similar: [] }
  const { match, similar } = findPlace(to.replace(/[-_]/g, ' '))
  return { place: match, similar }
}

export function routeStartId(start: RouteStart, ownDeskId: string | null): string {
  return start === 'desk' && ownDeskId ? ownDeskId : LIFT_ID
}

export interface RoutePlan {
  route: Route
  from: Place
  to: Place
}

export function planRoute(toId: string, fromId: string): RoutePlan | null {
  const from = getPlace(fromId)
  const to = getPlace(toId)
  const route = routeToPlace(toId, fromId)
  if (!from || !to || !route) return null
  return { route, from, to }
}

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text)

/** Текст маршрута по шагам: лифт, подсказки рёбер графа, «ты на месте». */
export function routeSteps(plan: RoutePlan, t: Translate): string[] {
  const start =
    plan.from.type === 'lift'
      ? [t(`поднимись на лифте на ${FLOOR.number} этаж`, `take the lift to floor ${FLOOR.number}`)]
      : []
  const hints = plan.route.text.split(', ').filter(Boolean)
  const finish = t(`ты на месте: ${plan.to.name}`, `you are there: ${plan.to.name}`)
  return [...start, ...hints, finish].map(capitalize)
}

export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / WALK_M_PER_MIN))
}

export function placeCenter(place: Place): [number, number] {
  return [place.x + place.w / 2, place.y + place.d / 2]
}

/** Точки линии маршрута в координатах сетки: центр старта, узлы коридора, центр цели. */
export function routePath(plan: RoutePlan): Array<[number, number]> {
  const nodes = plan.route.nodes.map((node): [number, number] => [node.x, node.y])
  return [placeCenter(plan.from), ...nodes, placeCenter(plan.to)]
}

/** Метров от одного места до другого или null, если пути нет. */
export function distanceBetween(fromId: string, toId: string): number | null {
  return routeToPlace(toId, fromId)?.length ?? null
}

export function askBuddyQuestion(place: Place, t: Translate): string {
  return t(`Где ${place.name}?`, `Where is ${place.name}?`)
}
