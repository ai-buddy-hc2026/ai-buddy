import { describe, expect, it } from 'vitest'
import { mustEmployee } from '@/entities/employees'
import { MAP_EDGES, MAP_NODES, getPlace, type Place } from '@/entities/places'
import type { Translate } from '@/shared/lib/i18n'
import { corridorRects, pinWidth, placeFootprint } from './floorLayout'
import {
  askBuddyQuestion,
  deskOwner,
  distanceBetween,
  planRoute,
  remoteMatches,
  resolveTarget,
  routePath,
  routeStartId,
  routeSteps,
  searchPlaces,
  walkMinutes,
} from './mapLogic'

const ru: Translate = (text) => text
const place = (id: string): Place => {
  const found = getPlace(id)
  if (!found) throw new Error(id)
  return found
}

describe('searchPlaces', () => {
  it('returns all places for an empty query', () => {
    const result = searchPlaces('  ')
    expect(result.places.length).toBeGreaterThan(5)
    expect(result.isFuzzy).toBe(false)
  })

  it('finds Baikal by any spelling', () => {
    for (const query of ['Байкал', 'байкал', 'переговорка байкал', 'Где Байкал?']) {
      expect(searchPlaces(query).places.map((p) => p.id)).toEqual(['room-baikal'])
    }
  })

  it('finds a desk by owner name', () => {
    expect(searchPlaces('Илья').places.map((p) => p.id)).toEqual(['desk-ilya'])
  })

  it('applies the type filter', () => {
    const result = searchPlaces('', 'room')
    expect(result.places.every((p) => p.type === 'room')).toBe(true)
    expect(searchPlaces('байкал', 'kitchen').places).toEqual([])
  })

  it('offers similar places when nothing matches exactly', () => {
    const result = searchPlaces('переговорка')
    expect(result.places.length).toBeGreaterThan(0)
    expect(searchPlaces('бассейн').places).toEqual([])
  })
})

describe('remoteMatches', () => {
  it('returns employees without a desk', () => {
    expect(remoteMatches('Тимур').map((e) => e.id)).toEqual(['timur'])
    expect(remoteMatches('Илья')).toEqual([])
    expect(remoteMatches('т')).toEqual([])
  })
})

describe('deskOwner', () => {
  const anya = mustEmployee('anya')

  it('separates self, teammate and other team', () => {
    expect(deskOwner(place('desk-anya'), anya)?.kind).toBe('self')
    expect(deskOwner(place('desk-ilya'), anya)?.kind).toBe('teammate')
    expect(deskOwner(place('desk-dasha'), anya)?.kind).toBe('other')
  })

  it('returns null for non-desk places', () => {
    expect(deskOwner(place('kitchen'), anya)).toBeNull()
  })
})

describe('resolveTarget', () => {
  it('resolves a place id', () => {
    expect(resolveTarget('room-baikal').place?.id).toBe('room-baikal')
  })

  it('resolves free text through find_place', () => {
    expect(resolveTarget('байкал').place?.id).toBe('room-baikal')
  })

  it('returns nothing for an empty or unknown target', () => {
    expect(resolveTarget(undefined)).toEqual({ place: null, similar: [] })
    expect(resolveTarget('room-sochi').place).toBeNull()
  })
})

describe('route', () => {
  it('starts from the lift unless the own desk is chosen', () => {
    expect(routeStartId('lift', 'desk-anya')).toBe('lift')
    expect(routeStartId('desk', 'desk-anya')).toBe('desk-anya')
    expect(routeStartId('desk', null)).toBe('lift')
  })

  it('builds steps from the lift to Baikal', () => {
    const plan = planRoute('room-baikal', 'lift')
    expect(plan).not.toBeNull()
    if (!plan) return
    const steps = routeSteps(plan, ru)
    expect(steps[0]).toBe('Поднимись на лифте на 3 этаж')
    expect(steps[1]).toBe('От лифта направо по коридору')
    expect(steps.at(-1)).toBe('Ты на месте: Переговорка Байкал')
    expect(plan.route.length).toBe(25)
  })

  it('draws the path from place center through nodes to target center', () => {
    const plan = planRoute('room-baikal', 'lift')
    if (!plan) throw new Error('no plan')
    const path = routePath(plan)
    expect(path[0]).toEqual([0.5, 4])
    expect(path.at(-1)).toEqual([9, 1])
    expect(path).toHaveLength(plan.route.nodes.length + 2)
  })

  it('skips the lift step when starting from a desk', () => {
    const plan = planRoute('kitchen', 'desk-anya')
    if (!plan) throw new Error('no plan')
    expect(routeSteps(plan, ru)[0]).not.toContain('лифте')
  })

  it('returns null for an unknown place', () => {
    expect(planRoute('room-sochi', 'lift')).toBeNull()
    expect(distanceBetween('lift', 'room-sochi')).toBeNull()
  })

  it('measures distance between desks', () => {
    expect(distanceBetween('desk-anya', 'desk-ilya')).toBe(0)
    expect(distanceBetween('desk-anya', 'kitchen')).toBe(11)
  })

  it('rounds walking time up to at least a minute', () => {
    expect(walkMinutes(0)).toBe(1)
    expect(walkMinutes(71)).toBe(2)
  })
})

describe('floor layout', () => {
  it('has a corridor strip per edge covering both nodes', () => {
    const rects = corridorRects()
    expect(rects).toHaveLength(MAP_EDGES.length)
    for (const node of MAP_NODES) {
      const covered = rects.some(
        (r) => node.x >= r.x && node.x <= r.x + r.w && node.y >= r.y && node.y <= r.y + r.d,
      )
      expect(covered).toBe(true)
    }
  })

  it('shrinks desks but keeps rooms full size', () => {
    expect(placeFootprint(place('desk-anya')).w).toBeLessThan(1)
    expect(placeFootprint(place('room-baikal'))).toEqual({ x: 8, y: 0, w: 2, d: 2 })
  })

  it('makes longer pin labels wider', () => {
    expect(pinWidth('Наставник')).toBeGreaterThan(pinWidth('Ты'))
  })
})

describe('askBuddyQuestion', () => {
  it('asks where the place is', () => {
    expect(askBuddyQuestion(place('room-baikal'), ru)).toBe('Где Переговорка Байкал?')
  })
})
