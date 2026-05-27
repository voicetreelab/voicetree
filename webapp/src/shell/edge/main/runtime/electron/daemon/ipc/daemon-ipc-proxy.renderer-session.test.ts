import { describe, expect, test } from 'vitest'
import type { GraphDbClient } from '@vt/graph-db-client'
import type { State } from '@vt/graph-state'

import {
  getOrCreateRendererSession,
  syncRendererSessionState,
} from './daemon-ipc-proxy'

/**
 * Black-box behavioral tests for BF-340.
 *
 * Spec requirement (daemon-folder-tree-read-model):
 *   "Renderer live-state synchronization SHALL reuse sessions by default" —
 *   repeated calls against the same daemon base URL MUST NOT spawn a new
 *   daemon session per call. Session selection/layout sync MUST still be
 *   propagated on the reused session.
 *
 * We assert on the fake client's recorded session-creation count and on the
 * sequence of method invocations that occur as observable side effects.
 * No internal modules are mocked; the test exercises the real proxy
 * functions against a hand-rolled fake GraphDbClient.
 */

type FakeClientRecord = {
  createSessionCount: number
  setSelectionCalls: { sessionId: string; mode: string; nodeIds: readonly string[] }[]
  updateLayoutCalls: { sessionId: string; pan?: { x: number; y: number }; zoom?: number }[]
}

type FakeClient = GraphDbClient & { __record: FakeClientRecord }

function makeFakeClient(baseUrl: string): FakeClient {
  const record: FakeClientRecord = {
    createSessionCount: 0,
    setSelectionCalls: [],
    updateLayoutCalls: [],
  }

  // Each createSession() returns a fresh, deterministic session id so callers
  // can assert that a new session was (or was not) created.
  let nextSessionOrdinal: number = 0

  const client: Partial<GraphDbClient> & { __record: FakeClientRecord } = {
    baseUrl,
    __record: record,
    createSession: async (): Promise<{ sessionId: string }> => {
      record.createSessionCount += 1
      nextSessionOrdinal += 1
      return { sessionId: `${baseUrl}#session-${nextSessionOrdinal}` }
    },
    setSelection: async (
      sessionId: string,
      req: { mode: string; nodeIds: readonly string[] },
    ): Promise<unknown> => {
      record.setSelectionCalls.push({ sessionId, mode: req.mode, nodeIds: req.nodeIds })
      return { selection: [...req.nodeIds] }
    },
    updateLayout: async (
      sessionId: string,
      layout: { pan?: { x: number; y: number }; zoom?: number },
    ): Promise<unknown> => {
      record.updateLayoutCalls.push({ sessionId, pan: layout.pan, zoom: layout.zoom })
      return { layout }
    },
  }

  return client as FakeClient
}

function makeLocalState(partial: {
  selection?: readonly string[]
  pan?: { x: number; y: number }
  zoom?: number
}): State {
  return {
    graph: { nodes: {}, edges: {} } as unknown as State['graph'],
    roots: { loaded: new Set<string>(), folderTree: [] },
    collapseSet: new Set<string>(),
    selection: new Set<string>(partial.selection ?? []),
    layout: {
      positions: new Map(),
      ...(partial.pan ? { pan: partial.pan } : {}),
      ...(partial.zoom !== undefined ? { zoom: partial.zoom } : {}),
    },
    meta: {
      schemaVersion: 1,
      revision: 0,
    },
  }
}

describe('renderer session reuse (BF-340)', () => {
  test('two consecutive getOrCreateRendererSession calls with the same baseUrl create exactly one session', async () => {
    const client: FakeClient = makeFakeClient('http://daemon.test:9999')
    const sessionStore = { current: null }

    const first: string = await getOrCreateRendererSession(client, sessionStore)
    const second: string = await getOrCreateRendererSession(client, sessionStore)

    expect(client.__record.createSessionCount).toBe(1)
    expect(second).toBe(first)
  })

  test('changing the client baseUrl forces a fresh session', async () => {
    const clientA: FakeClient = makeFakeClient('http://daemon-a.test:9999')
    const clientB: FakeClient = makeFakeClient('http://daemon-b.test:9999')
    const sessionStore = { current: null }

    const idA1: string = await getOrCreateRendererSession(clientA, sessionStore)
    const idB: string = await getOrCreateRendererSession(clientB, sessionStore)
    const idA2: string = await getOrCreateRendererSession(clientA, sessionStore)

    expect(clientA.__record.createSessionCount).toBe(2)
    expect(clientB.__record.createSessionCount).toBe(1)
    expect(idA1).not.toBe(idB)
    // After switching back to clientA, the cache held clientB's session, so
    // a new session is created on clientA.
    expect(idA2).not.toBe(idA1)
  })

  test('syncRendererSessionState propagates selection and layout on the reused session', async () => {
    const client: FakeClient = makeFakeClient('http://daemon.test:9999')
    const sessionStore = { current: null }

    const firstSync: string = await syncRendererSessionState(
      client,
      makeLocalState({ selection: ['node-a', 'node-b'], pan: { x: 10, y: 20 }, zoom: 1.5 }),
      sessionStore,
    )

    const secondSync: string = await syncRendererSessionState(
      client,
      makeLocalState({ selection: ['node-c'], pan: { x: 11, y: 21 }, zoom: 2.0 }),
      sessionStore,
    )

    // Session is reused: one createSession total.
    expect(client.__record.createSessionCount).toBe(1)
    expect(secondSync).toBe(firstSync)

    // Both selection mutations were observed, both bound to the reused session.
    expect(client.__record.setSelectionCalls).toHaveLength(2)
    expect(client.__record.setSelectionCalls[0]!.sessionId).toBe(firstSync)
    expect(client.__record.setSelectionCalls[0]!.nodeIds).toEqual(['node-a', 'node-b'])
    expect(client.__record.setSelectionCalls[1]!.sessionId).toBe(firstSync)
    expect(client.__record.setSelectionCalls[1]!.nodeIds).toEqual(['node-c'])

    // Both layout updates were observed, both bound to the reused session.
    expect(client.__record.updateLayoutCalls).toHaveLength(2)
    expect(client.__record.updateLayoutCalls[0]!.sessionId).toBe(firstSync)
    expect(client.__record.updateLayoutCalls[0]!.pan).toEqual({ x: 10, y: 20 })
    expect(client.__record.updateLayoutCalls[0]!.zoom).toBe(1.5)
    expect(client.__record.updateLayoutCalls[1]!.sessionId).toBe(firstSync)
    expect(client.__record.updateLayoutCalls[1]!.pan).toEqual({ x: 11, y: 21 })
    expect(client.__record.updateLayoutCalls[1]!.zoom).toBe(2.0)
  })
})
