import { describe, it, expect } from 'vitest'

/**
 * Tests for the two-phase layout helper functions.
 * These functions are internal to autoLayout.ts, so we test them via their exported
 * behavior or by extracting them. For now, we test the logic inline.
 */

// Re-implement the pure helper functions here for testing
// (In a real scenario, these could be extracted to a separate testable module)

interface Position {
  readonly x: number
  readonly y: number
}

type PositionMap = ReadonlyMap<string, Position>

function findTopNDisplacedFromMaps(
  before: PositionMap,
  after: PositionMap,
  n: number
): Array<{ id: string; displacement: number }> {
  const displacements: Array<{ id: string; displacement: number }> = []

  before.forEach((beforePos: Position, id: string) => {
    const afterPos: Position | undefined = after.get(id)
    if (afterPos) {
      const displacement: number = Math.hypot(
        afterPos.x - beforePos.x,
        afterPos.y - beforePos.y
      )
      displacements.push({ id, displacement })
    }
  })

  displacements.sort((a, b) => b.displacement - a.displacement)
  return displacements.slice(0, n)
}

function getClosestNodesByEuclideanFromPositions(
  allPositions: PositionMap,
  seedIds: Set<string>,
  count: number
): Set<string> {
  const distances: Array<{ id: string; distance: number }> = []

  allPositions.forEach((pos: Position, id: string) => {
    if (seedIds.has(id)) {
      distances.push({ id, distance: 0 })
      return
    }

    let minDist: number = Infinity
    seedIds.forEach((seedId: string) => {
      const seedPos: Position | undefined = allPositions.get(seedId)
      if (seedPos) {
        const dist: number = Math.hypot(pos.x - seedPos.x, pos.y - seedPos.y)
        minDist = Math.min(minDist, dist)
      }
    })

    distances.push({ id, distance: minDist })
  })

  distances.sort((a, b) => a.distance - b.distance)
  return new Set(distances.slice(0, count).map(d => d.id))
}

describe('Two-Phase Layout Helper Functions', () => {
  describe('findTopNDisplacedFromMaps', () => {
    it('should find the single most displaced node', () => {
      const before: PositionMap = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 100 }],
        ['c', { x: 200, y: 200 }],
      ])
      const after: PositionMap = new Map([
        ['a', { x: 10, y: 0 }],   // moved 10px
        ['b', { x: 100, y: 150 }], // moved 50px
        ['c', { x: 200, y: 200 }], // no movement
      ])

      const result: Array<{ id: string; displacement: number }> = findTopNDisplacedFromMaps(before, after, 1)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('b')
      expect(result[0].displacement).toBe(50)
    })

    it('should find top 3 most displaced nodes in order', () => {
      const before: PositionMap = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 0, y: 0 }],
        ['c', { x: 0, y: 0 }],
        ['d', { x: 0, y: 0 }],
      ])
      const after: PositionMap = new Map([
        ['a', { x: 30, y: 40 }],  // moved 50px (3-4-5 triangle)
        ['b', { x: 100, y: 0 }],  // moved 100px
        ['c', { x: 0, y: 10 }],   // moved 10px
        ['d', { x: 60, y: 80 }],  // moved 100px (6-8-10 triangle)
      ])

      const result: Array<{ id: string; displacement: number }> = findTopNDisplacedFromMaps(before, after, 3)

      expect(result).toHaveLength(3)
      // b and d both moved 100px, then a moved 50px
      expect(result.map(r => r.id)).toContain('b')
      expect(result.map(r => r.id)).toContain('d')
      expect(result.map(r => r.id)).toContain('a')
      expect(result.map(r => r.id)).not.toContain('c')
    })

    it('should return empty array when no nodes exist', () => {
      const before: PositionMap = new Map()
      const after: PositionMap = new Map()

      const result: Array<{ id: string; displacement: number }> = findTopNDisplacedFromMaps(before, after, 3)

      expect(result).toHaveLength(0)
    })

    it('should handle case where n is larger than node count', () => {
      const before: PositionMap = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 0, y: 0 }],
      ])
      const after: PositionMap = new Map([
        ['a', { x: 10, y: 0 }],
        ['b', { x: 20, y: 0 }],
      ])

      const result: Array<{ id: string; displacement: number }> = findTopNDisplacedFromMaps(before, after, 10)

      expect(result).toHaveLength(2)
    })

    it('should only include nodes present in both snapshots', () => {
      const before: PositionMap = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 0, y: 0 }],
      ])
      const after: PositionMap = new Map([
        ['a', { x: 100, y: 0 }],
        ['c', { x: 50, y: 0 }], // new node, not in before
      ])

      const result: Array<{ id: string; displacement: number }> = findTopNDisplacedFromMaps(before, after, 3)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')
    })
  })

  describe('getClosestNodesByEuclideanFromPositions', () => {
    it('should include seed nodes with distance 0', () => {
      const positions: PositionMap = new Map([
        ['seed', { x: 0, y: 0 }],
        ['far', { x: 1000, y: 1000 }],
      ])
      const seeds: Set<string> = new Set(['seed'])

      const result: Set<string> = getClosestNodesByEuclideanFromPositions(positions, seeds, 2)

      expect(result.has('seed')).toBe(true)
    })

    it('should find closest nodes by euclidean distance to any seed', () => {
      const positions: PositionMap = new Map([
        ['seed1', { x: 0, y: 0 }],
        ['seed2', { x: 100, y: 0 }],
        ['close_to_seed1', { x: 10, y: 0 }],  // 10px from seed1
        ['close_to_seed2', { x: 90, y: 0 }],  // 10px from seed2
        ['far', { x: 500, y: 500 }],          // far from both
      ])
      const seeds: Set<string> = new Set(['seed1', 'seed2'])

      const result: Set<string> = getClosestNodesByEuclideanFromPositions(positions, seeds, 4)

      expect(result.has('seed1')).toBe(true)
      expect(result.has('seed2')).toBe(true)
      expect(result.has('close_to_seed1')).toBe(true)
      expect(result.has('close_to_seed2')).toBe(true)
      expect(result.has('far')).toBe(false)
    })

    it('should return all nodes when count exceeds node count', () => {
      const positions: PositionMap = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
      ])
      const seeds: Set<string> = new Set(['a'])

      const result: Set<string> = getClosestNodesByEuclideanFromPositions(positions, seeds, 10)

      expect(result.size).toBe(2)
      expect(result.has('a')).toBe(true)
      expect(result.has('b')).toBe(true)
    })

    it('should handle multiple seeds and find minimum distance to any', () => {
      const positions: PositionMap = new Map([
        ['seed1', { x: 0, y: 0 }],
        ['seed2', { x: 100, y: 0 }],
        ['middle', { x: 50, y: 0 }], // 50px from both seeds
        ['closer_to_seed2', { x: 80, y: 0 }], // 20px from seed2
      ])
      const seeds: Set<string> = new Set(['seed1', 'seed2'])

      const result: Set<string> = getClosestNodesByEuclideanFromPositions(positions, seeds, 3)

      // Should include seeds (dist 0) and closer_to_seed2 (dist 20), not middle (dist 50)
      expect(result.has('seed1')).toBe(true)
      expect(result.has('seed2')).toBe(true)
      expect(result.has('closer_to_seed2')).toBe(true)
      expect(result.has('middle')).toBe(false)
    })

    it('should work with disconnected clusters (spatially close but graph-disconnected)', () => {
      // Simulates VoiceTree's spatially-arranged but unconnected subgraphs
      const positions: PositionMap = new Map([
        ['cluster1_a', { x: 0, y: 0 }],
        ['cluster1_b', { x: 20, y: 0 }],
        ['cluster2_a', { x: 25, y: 0 }], // Spatially close to cluster1 but graph-disconnected
        ['cluster2_b', { x: 45, y: 0 }],
        ['far_away', { x: 1000, y: 1000 }],
      ])
      const seeds: Set<string> = new Set(['cluster1_a'])

      const result: Set<string> = getClosestNodesByEuclideanFromPositions(positions, seeds, 4)

      // Should include nearby nodes regardless of graph connectivity
      expect(result.has('cluster1_a')).toBe(true)
      expect(result.has('cluster1_b')).toBe(true)
      expect(result.has('cluster2_a')).toBe(true)
      expect(result.has('cluster2_b')).toBe(true)
      expect(result.has('far_away')).toBe(false)
    })
  })
})
