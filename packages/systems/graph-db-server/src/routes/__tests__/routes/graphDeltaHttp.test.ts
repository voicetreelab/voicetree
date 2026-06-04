import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { resetUndoState } from '../../../state/undo-store.ts'
import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { getCurrentSeq } from '../../../state/events/deltaEventBus.ts'

function parseSSEGraphEvents(text: string): readonly ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) continue
    try {
      graphs.push(JSON.parse(dataLine.slice('data:'.length).trim()))
    } catch {
      // Ignore malformed partial blocks while the stream is still being read.
    }
  }
  return graphs
}

async function readProjectedGraph(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 5000,
): Promise<ProjectedGraph> {
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for projectedGraph SSE event')), remainingMs)
    })
    const result = await Promise.race([reader.read(), timeout])
    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const graphs = parseSSEGraphEvents(buffered)
    if (graphs.length > 0) return graphs[graphs.length - 1]!
  }

  throw new Error('Timed out waiting for projectedGraph SSE event')
}

async function withTempProject(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-delta-test-'))
}

async function createVoicetreeHome(project: string): Promise<string> {
  const voicetreeHome = await mkdtemp(join(tmpdir(), 'graphd-delta-appsupport-'))
  const config = {
    projectConfig: {
      [project]: { writeFolderPath: project },
    },
  }
  await writeFile(join(voicetreeHome, 'voicetree-config.json'), JSON.stringify(config))
  return voicetreeHome
}

describe('HTTP graph delta writes', () => {
  let project: string
  let voicetreeHome: string
  let handles: DaemonHandle[]
  let sseController: AbortController | null

  beforeEach(async () => {
    project = await withTempProject()
    voicetreeHome = await createVoicetreeHome(project)
    handles = []
    sseController = null
    resetUndoState()
  })

  afterEach(async () => {
    sseController?.abort()
    await new Promise(r => setTimeout(r, 50))
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(project, { recursive: true, force: true })
    await rm(voicetreeHome, { recursive: true, force: true })
  }, 15000)

  test('applies a session-tagged delta and returns an ack from /graph/delta', async () => {
    const handle = await startDaemon({ project, voicetreeHomePath: voicetreeHome })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`
    const testNodePath = join(project, 'test-node-http.md')
    const delta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: testNodePath,
          contentWithoutYamlOrLinks: '# Test HTTP Node\nHello from HTTP',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: {},
          },
        },
        previousNode: { _tag: 'None' },
      },
    ]

    const res = await fetch(`${base}/graph/delta`, {
      body: JSON.stringify(delta),
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': 'renderer-session-123',
      },
      method: 'POST',
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const graphRes = await fetch(`${base}/graph`)
    expect(graphRes.status).toBe(200)
    const graphBody = await graphRes.json()
    expect(graphBody.nodes[testNodePath]).toBeDefined()
    expect(graphBody.nodes[testNodePath].absoluteFilePathIsID).toBe(testNodePath)

    await expect(readFile(testNodePath, 'utf8')).resolves.toContain(
      '# Test HTTP Node',
    )
  }, 20000)

  test('apply-delta returns ack, updates graph, publishes SSE, and respects recordForUndo false', async () => {
    const handle = await startDaemon({ project, voicetreeHomePath: voicetreeHome })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`
    const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(createRes.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

    sseController = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, {
      signal: sseController.signal,
    })
    expect(sseRes.status).toBe(200)
    const reader = sseRes.body!.getReader()
    await reader.read()

    const testNodePath = join(project, 'no-undo-node.md')
    const expectedSeq = getCurrentSeq() + 1
    const delta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: testNodePath,
          contentWithoutYamlOrLinks: '# No Undo\nApplied without undo history',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: {},
          },
        },
        previousNode: { _tag: 'None' },
      },
    ]

    const res = await fetch(`${base}/graph/apply-delta`, {
      body: JSON.stringify({ delta, recordForUndo: false }),
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
      },
      method: 'POST',
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const graphRes = await fetch(`${base}/graph`)
    expect(graphRes.status).toBe(200)
    const graphBody = await graphRes.json()
    expect(graphBody.nodes[testNodePath]).toBeDefined()
    await expect(readFile(testNodePath, 'utf8')).resolves.toContain('# No Undo')

    const projectedGraph = await readProjectedGraph(reader)
    expect(projectedGraph.seq).toBe(expectedSeq)
    expect(projectedGraph.recentNodeIds).toEqual([testNodePath])
    expect(projectedGraph.nodes.find(node => node.id === testNodePath)).toBeDefined()

    const undoRes = await fetch(`${base}/graph/undo`, { method: 'POST' })
    await expect(undoRes.json()).resolves.toEqual({ applied: false })
  }, 20000)

  test('delete-node returns ack, updates graph, and publishes SSE', async () => {
    const handle = await startDaemon({ project, voicetreeHomePath: voicetreeHome })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`
    const testNodePath = join(project, 'delete-node-http.md')
    const delta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: testNodePath,
          contentWithoutYamlOrLinks: '# Delete HTTP Node\nDeleted through HTTP',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: {},
          },
        },
        previousNode: { _tag: 'None' },
      },
    ]

    const createRes = await fetch(`${base}/graph/delta`, {
      body: JSON.stringify(delta),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(createRes.status).toBe(200)

    const sessionRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(sessionRes.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await sessionRes.json())

    sseController = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, {
      signal: sseController.signal,
    })
    expect(sseRes.status).toBe(200)
    const reader = sseRes.body!.getReader()
    await reader.read()

    const expectedSeq = getCurrentSeq() + 1
    const deleteRes = await fetch(
      `${base}/graph/node/${encodeURIComponent(testNodePath)}`,
      {
        headers: { 'X-Session-Id': sessionId },
        method: 'DELETE',
      },
    )

    expect(deleteRes.status).toBe(200)
    await expect(deleteRes.json()).resolves.toEqual({ ok: true })

    const graphRes = await fetch(`${base}/graph`)
    expect(graphRes.status).toBe(200)
    const graphBody = await graphRes.json()
    expect(graphBody.nodes[testNodePath]).toBeUndefined()
    await expect(readFile(testNodePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const projectedGraph = await readProjectedGraph(reader)
    expect(projectedGraph.seq).toBe(expectedSeq)
    expect(projectedGraph.nodes.find(node => node.id === testNodePath)).toBeUndefined()
  }, 20000)

  // Regression: creating a context node must broadcast it on the per-session
  // projectedGraph SSE, exactly like a plain delta does. Without the publish in
  // createContextNode, the node lands on disk + in mem but never reaches
  // subscribers — so a browser (no optimistic local apply) never sees it and the
  // agent terminal anchored to it never renders. This asserts the SSE frame
  // arrives; pre-fix it never does and readProjectedGraph times out.
  test('context-node creation publishes the new node on the projectedGraph SSE', async () => {
    const handle = await startDaemon({ project, voicetreeHomePath: voicetreeHome })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    // Seed a parent node to create context for.
    const parentPath = join(project, 'parent-for-context.md')
    const parentDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: parentPath,
          contentWithoutYamlOrLinks: '# Parent\nContext source',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: {},
          },
        },
        previousNode: { _tag: 'None' },
      },
    ]
    const seedRes = await fetch(`${base}/graph/delta`, {
      body: JSON.stringify(parentDelta),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(seedRes.status).toBe(200)

    // Open a session SSE and drain the initial snapshot frame.
    const sessionRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(sessionRes.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await sessionRes.json())
    sseController = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, {
      signal: sseController.signal,
    })
    expect(sseRes.status).toBe(200)
    const reader = sseRes.body!.getReader()
    await reader.read()

    // Create the context node.
    const ctxRes = await fetch(`${base}/graph/context-node`, {
      body: JSON.stringify({ parentNodeId: parentPath, semanticNodeIds: [] }),
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      method: 'POST',
    })
    expect(ctxRes.status).toBe(200)
    const { nodeId: contextNodeId } = await ctxRes.json() as { nodeId: string }
    expect(contextNodeId).toContain('ctx-nodes')

    // The decisive assertion: a projectedGraph SSE frame carrying the new
    // context node must arrive (pre-fix this times out — nothing is published).
    const projectedGraph = await readProjectedGraph(reader)
    expect(projectedGraph.nodes.find(node => node.id === contextNodeId)).toBeDefined()
  }, 20000)

  test('rejects invalid graph delta payloads', async () => {
    const handle = await startDaemon({ project, voicetreeHomePath: voicetreeHome })
    handles.push(handle)

    const res = await fetch(`http://127.0.0.1:${handle.port}/graph/delta`, {
      body: JSON.stringify({ type: 'UpsertNode' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_GRAPH_DELTA',
      error: 'Invalid GraphDelta request body',
    })
  })
})
