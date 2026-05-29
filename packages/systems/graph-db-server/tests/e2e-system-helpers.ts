// Test helpers for `e2e-system.test.ts`. Extracted to keep the spec body
// under the 500-line guard. Pure utility functions + thin HTTP wrappers that
// call the public daemon API — no shared mutable state.

import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'

import { SessionCreateResponseSchema } from '../src/daemon/index.ts'

export async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== null) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('condition not met before timeout')
}

export function makeNode(absolutePath: string, content: string, agentName = 'e2e'): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: { agent_name: agentName },
    },
  }
}

export function upsertDelta(node: GraphNode): GraphDelta {
  return [{ type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }]
}

// Mark `p` as an active read path on the daemon so the watcher mounts it
// alongside the writeFolderPath. Implemented over the public session
// folder-state API (the legacy /project/read-paths route is gone). Creates a
// transient session for the PATCH and deletes it afterwards so the helper
// leaves sessionCount untouched — tests that assert on session counts must
// not see this scaffolding session in their totals.
export async function addReadPath(baseUrl: string, p: string): Promise<void> {
  const sessionRes = await fetch(`${baseUrl}/sessions`, { method: 'POST' })
  const { sessionId } = SessionCreateResponseSchema.parse(await sessionRes.json())
  try {
    const patchRes = await fetch(
      `${baseUrl}/sessions/${sessionId}/folder-state/${encodeURIComponent(p)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'expanded' }),
      },
    )
    if (patchRes.status !== 200) {
      throw new Error(`addReadPath ${p}: ${patchRes.status} ${await patchRes.text()}`)
    }
  } finally {
    await fetch(`${baseUrl}/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {})
  }
}
