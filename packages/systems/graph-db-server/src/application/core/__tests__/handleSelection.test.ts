import { describe, expect, test } from 'vitest'
import { handleSelection } from '../handleSelection.ts'
import type { Session } from '../../domain/session.ts'

function sessionFixture(): Session {
  return {
    id: 'session-1',
    collapseSet: new Set<string>(),
    selection: new Set<string>(['alpha', 'beta']),
    expandOverrides: new Set<string>(),
    layout: {
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    lastAccessedAt: 100,
  }
}

describe('handleSelection', () => {
  test('updates selection and touches the registry', () => {
    const session = sessionFixture()

    const result = handleSelection(session, ['beta', 'gamma'], 'add')

    expect(result).toEqual({
      session: {
        ...session,
        selection: new Set<string>(['alpha', 'beta', 'gamma']),
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: { selection: ['alpha', 'beta', 'gamma'] },
    })
    expect(session.selection).toEqual(new Set<string>(['alpha', 'beta']))
  })
})
