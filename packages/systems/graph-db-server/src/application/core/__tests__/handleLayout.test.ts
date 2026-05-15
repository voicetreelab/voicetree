import { describe, expect, test } from 'vitest'
import { handleLayout } from '../handleLayout.ts'
import type { Session } from '../session.ts'

function sessionFixture(): Session {
  return {
    id: 'session-1',
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    expandOverrides: new Set<string>(),
    layout: {
      positions: {
        alpha: { x: 1, y: 2 },
        beta: { x: 3, y: 4 },
      },
      pan: { x: 10, y: 20 },
      zoom: 1.5,
    },
    lastAccessedAt: 100,
  }
}

describe('handleLayout', () => {
  test('merges positions, preserves omitted viewport fields, and touches the registry', () => {
    const session = sessionFixture()

    const result = handleLayout(session, {
      positions: {
        beta: { x: 30, y: 40 },
        gamma: { x: 5, y: 6 },
      },
    })

    expect(result).toEqual({
      session: {
        ...session,
        layout: {
          positions: {
            alpha: { x: 1, y: 2 },
            beta: { x: 30, y: 40 },
            gamma: { x: 5, y: 6 },
          },
          pan: { x: 10, y: 20 },
          zoom: 1.5,
        },
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: {
        layout: {
          positions: {
            alpha: { x: 1, y: 2 },
            beta: { x: 30, y: 40 },
            gamma: { x: 5, y: 6 },
          },
          pan: { x: 10, y: 20 },
          zoom: 1.5,
        },
      },
    })
  })
})
