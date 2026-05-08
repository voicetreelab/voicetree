import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../server.ts'
import { SessionCreateResponseSchema } from '../contract.ts'
import type { ProjectedGraph } from '@vt/graph-state/contract'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-sse-test-'))
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(join(tmpdir(), 'graphd-sse-appsupport-'))
  const config = {
    vaultConfig: {
      [vault]: { writePath: vault },
    },
  }
  await writeFile(join(appSupport, 'voicetree-config.json'), JSON.stringify(config))
  return appSupport
}

function parseSSEGraphEvents(text: string): ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (dataLine) {
      const json = dataLine.slice('data:'.length).trim()
      try {
        graphs.push(JSON.parse(json))
      } catch { /* skip malformed */ }
    }
  }
  return graphs
}

describe('SSE session events', () => {
  let vault: string
  let appSupport: string
  let handles: DaemonHandle[]
  let sseController: AbortController | null

  beforeEach(async () => {
    vault = await withTempVault()
    appSupport = await createAppSupport(vault)
    handles = []
    sseController = null
  })

  afterEach(async () => {
    sseController?.abort()
    await new Promise(r => setTimeout(r, 50))
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15000)

  test('receives projected graph via SSE for HTTP writes and FS writes', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
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
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream')

    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    const receivedGraphs: ProjectedGraph[] = []

    await reader.read()

    const collectEvents = async (timeoutMs = 3000): Promise<void> => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline && !sseController!.signal.aborted) {
        const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) => {
          const t = setTimeout(() => resolve({ done: true, value: undefined }), Math.max(50, deadline - Date.now()))
          sseController!.signal.addEventListener('abort', () => { clearTimeout(t); resolve({ done: true, value: undefined }) })
        })
        const result = await Promise.race([reader.read(), timeoutPromise])
        if (result.done) break
        if (result.value) {
          const chunk = decoder.decode(result.value, { stream: true })
          receivedGraphs.push(...parseSSEGraphEvents(chunk))
          if (receivedGraphs.length > 0) break
        }
      }
    }

    const testNodePath = join(vault, 'test-node-http.md')
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

    const deltaRes = await fetch(`${base}/graph/delta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId,
      },
      body: JSON.stringify(delta),
    })
    expect(deltaRes.status).toBe(200)

    await collectEvents()
    expect(receivedGraphs.length).toBeGreaterThan(0)
    const httpGraph = receivedGraphs[receivedGraphs.length - 1]
    expect(httpGraph.nodes).toBeDefined()
    expect(httpGraph.edges).toBeDefined()
    const upsertedNode = httpGraph.nodes.find(n => n.id === testNodePath)
    expect(upsertedNode).toBeDefined()

    receivedGraphs.length = 0
    const externalFilePath = join(vault, 'external-write.md')
    await writeFile(externalFilePath, `---
agent_name: Ari
---
# External Node
Written directly to FS`)

    await collectEvents(5000)
    expect(receivedGraphs.length).toBeGreaterThan(0)
    const fsGraph = receivedGraphs[receivedGraphs.length - 1]
    const externalNode = fsGraph.nodes.find(n => n.id === externalFilePath)
    expect(externalNode).toBeDefined()
  }, 20000)

  test('returns 404 for non-existent session', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
    handles.push(handle)

    const res = await fetch(
      `http://127.0.0.1:${handle.port}/sessions/00000000-0000-4000-8000-000000000000/events`,
    )
    expect(res.status).toBe(404)
  })
})
