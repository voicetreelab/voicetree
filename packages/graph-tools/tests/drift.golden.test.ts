import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hydrateState, type SerializedState } from '@vt/graph-state'
import { describe, expect, it } from 'vitest'
import { computeDrift, type DriftData, type DriftReport } from '../src/debug/drift'
import type { CyDump } from '../src/debug/cyStateShape'

type DriftFixture = {
  data: SerializedState & { fsContentById?: Record<string, string | null> }
  projected: CyDump
  rendered: CyDump
  expected: DriftReport
  deep?: boolean
}

function expectWithTolerance(actual: unknown, expectedValue: unknown): void {
  if (typeof actual === 'number' && typeof expectedValue === 'number') {
    expect(actual).toBeCloseTo(expectedValue, 2)
    return
  }

  if (Array.isArray(actual) && Array.isArray(expectedValue)) {
    expect(actual).toHaveLength(expectedValue.length)
    actual.forEach((value, index) => {
      expectWithTolerance(value, expectedValue[index])
    })
    return
  }

  if (
    actual !== null
    && expectedValue !== null
    && typeof actual === 'object'
    && typeof expectedValue === 'object'
  ) {
    const actualRecord = actual as Record<string, unknown>
    const expectedRecord = expectedValue as Record<string, unknown>
    expect(Object.keys(actualRecord).sort()).toEqual(Object.keys(expectedRecord).sort())
    for (const key of Object.keys(expectedRecord)) {
      expectWithTolerance(actualRecord[key], expectedRecord[key])
    }
    return
  }

  expect(actual).toEqual(expectedValue)
}

function loadFixture(fileName: string): DriftFixture {
  const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'drift')
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, fileName), 'utf8')) as DriftFixture
}

function hydrateFixtureData(
  fixture: DriftFixture,
): { data: DriftData; projected: CyDump; rendered: CyDump; expected: DriftReport; deep: boolean } {
  const { fsContentById, ...serializedState } = fixture.data
  const state = hydrateState(serializedState)
  return {
    data: {
      ...state,
      ...(fsContentById ? { fsContentById } : {}),
    },
    projected: fixture.projected,
    rendered: fixture.rendered,
    expected: fixture.expected,
    deep: fixture.deep === true,
  }
}

describe('computeDrift golden fixtures', () => {
  const fixtureFiles = [
    'fixture-01-clean.json',
    'fixture-02-gap-a.json',
    'fixture-03-gap-b.json',
    'fixture-04-gap-c.json',
    'fixture-05-multi.json',
  ]

  for (const fileName of fixtureFiles) {
    it(fileName, () => {
      const fixture = hydrateFixtureData(loadFixture(fileName))
      const actual = computeDrift(fixture.data, fixture.projected, fixture.rendered, {
        deep: fixture.deep,
      })
      expectWithTolerance(actual, fixture.expected)
    })
  }
})
