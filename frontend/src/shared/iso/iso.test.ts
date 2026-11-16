import { boxFaces, depthOf, hashTo, project, sortByDepth, toPoints, type IsoGrid } from './iso'

const grid: IsoGrid = { tileW: 30, tileH: 17, originX: 100, originY: 50 }

describe('iso projection', () => {
  test('origin maps to the grid origin', () => {
    expect(project(grid, [0, 0, 0])).toEqual([100, 50])
  })

  test('x goes right-down, y goes left-down, z goes up', () => {
    expect(project(grid, [1, 0, 0])).toEqual([130, 67])
    expect(project(grid, [0, 1, 0])).toEqual([70, 67])
    expect(project(grid, [0, 0, 10])).toEqual([100, 40])
  })

  test('toPoints builds an SVG points string', () => {
    expect(
      toPoints(grid, [
        [0, 0, 0],
        [1, 0, 0],
      ]),
    ).toBe('100,50 130,67')
  })

  test('box has three visible faces with four corners each', () => {
    const faces = boxFaces(grid, { x: 0, y: 0, w: 1, d: 1, h: 20 })
    for (const face of [faces.top, faces.left, faces.right]) {
      expect(face.split(' ')).toHaveLength(4)
    }
    expect(faces.top.startsWith('100,30')).toBe(true)
  })

  test('far boxes are drawn before near ones', () => {
    const sorted = sortByDepth([
      { id: 'near', x: 2, y: 2 },
      { id: 'far', x: 0, y: 0 },
      { id: 'mid', x: 1, y: 1 },
    ])
    expect(sorted.map((b) => b.id)).toEqual(['far', 'mid', 'near'])
    expect(depthOf({ x: 1, y: 1, z: 10 })).toBeGreaterThan(depthOf({ x: 1, y: 1 }))
  })

  test('hashTo is stable and within range', () => {
    expect(hashTo('t7', 4)).toBe(hashTo('t7', 4))
    expect(hashTo('t7', 4)).toBeLessThan(4)
  })
})
