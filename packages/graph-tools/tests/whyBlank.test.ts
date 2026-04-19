import { describe, expect, it } from 'vitest'
import {
  diagnose,
  type BlankMessages,
  type BlankState,
  type RootDomInfo,
  type ScreenshotSample,
} from '../src/debug/whyBlank'

const SHOT: ScreenshotSample = { bytes: 2048 }

function makeMessages(overrides: Partial<BlankMessages> = {}): BlankMessages {
  return {
    console: [],
    exceptions: [],
    ...overrides,
  }
}

function makeState(overrides: Partial<BlankState> = {}): BlankState {
  return {
    loadedRoots: ['/tmp/vault'],
    graphNodeCount: 3,
    projectedNodeCount: 3,
    ...overrides,
  }
}

function makeRoot(overrides: Partial<RootDomInfo> = {}): RootDomInfo {
  return {
    exists: true,
    clientWidth: 1200,
    clientHeight: 800,
    rectWidth: 1200,
    rectHeight: 800,
    childElementCount: 1,
    display: 'block',
    visibility: 'visible',
    ...overrides,
  }
}

describe('diagnose', () => {
  it('detects uncaught startup exceptions first', () => {
    const result = diagnose(
      SHOT,
      makeMessages({ exceptions: [{ message: 'ReferenceError: boom' }] }),
      makeState(),
      makeRoot(),
    )

    expect(result.startsWith('Blank because:')).toBe(true)
  })

  it('detects zero-height root as a mount failure', () => {
    const result = diagnose(
      SHOT,
      makeMessages(),
      makeState(),
      makeRoot({ clientHeight: 0, rectHeight: 0 }),
    )

    expect(result.startsWith('React never mounted')).toBe(true)
  })

  it('detects missing loaded roots', () => {
    const result = diagnose(
      SHOT,
      makeMessages(),
      makeState({ loadedRoots: [], graphNodeCount: 0, projectedNodeCount: 0 }),
      makeRoot(),
    )

    expect(result.startsWith('no roots loaded')).toBe(true)
  })

  it('detects hidden root CSS distinctly from mount failures', () => {
    const result = diagnose(
      SHOT,
      makeMessages(),
      makeState(),
      makeRoot({ display: 'none', visibility: 'hidden', clientHeight: 0, rectHeight: 0 }),
    )

    expect(result.startsWith('Root hidden by CSS:')).toBe(true)
  })

  it('detects empty projection when data exists', () => {
    const result = diagnose(
      SHOT,
      makeMessages(),
      makeState({ graphNodeCount: 4, projectedNodeCount: 0 }),
      makeRoot(),
    )

    expect(result.startsWith('Projection is empty:')).toBe(true)
  })
})
