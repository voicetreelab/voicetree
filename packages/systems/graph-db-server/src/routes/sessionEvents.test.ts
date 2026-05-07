import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../server.ts'
import { SessionCreateResponseSchema } from '../contract.ts'
import type { SourceTaggedDelta } from '../events/deltaEventBus.ts'

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

function parseSSEEvents(text: string): SourceTaggedDelta[] {
  const events: SourceTaggedDelta[] = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const dataLine = block.split('\n').find(l => l.startsWith('data:'))
    if (dataLine) {
      const json = dataLine.slice('data:'.length).trim()
      try {
        events.push(JSON.parse(json))
      } catch { /* skip malformed */ }
    }
  }
  return events
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

  test('receives source-tagged deltas via SSE for HTTP writes and FS writes', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`

    // Create a session for SSE subscription
    const createRes = await fetch(`${base}/sessions`, { method: 'POST' })
    expect(createRes.status).toBe(201)
    const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

    // Connect to SSE endpoint
    sseController = new AbortController()
    const sseRes = await fetch(`${base}/sessions/${sessionId}/events`, {
      signal: sseController.signal,
    })
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream')

    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    const receivedEvents: SourceTaggedDelta[] = []

    // Read the initial ": connected" comment
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
          receivedEvents.push(...parseSSEEvents(chunk))
          if (receivedEvents.length > 0) break
        }
      }
    }

    // POST a delta with X-Session-Id header from a different session
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
        'X-Session-Id': 'other-session-123',
      },
      body: JSON.stringify(delta),
    })
    expect(deltaRes.status).toBe(200)

    // Read SSE events - should get the HTTP-sourced delta
    await collectEvents()
    const httpEvent = receivedEvents.find(e => e.source === 'session:other-session-123')
    expect(httpEvent).toBeDefined()
    expect(httpEvent!.delta.length).toBeGreaterThan(0)

    // Write a .md file directly to vault (simulating external FS write)
    receivedEvents.length = 0
    const externalFilePath = join(vault, 'external-write.md')
    await writeFile(externalFilePath, `---
agent_name: Ari
---
# External Node
Written directly to FS`)

    // Wait for chokidar to detect the change and publish the event
    await collectEvents(5000)
    const fsEvent = receivedEvents.find(e => e.source === 'fs:external')
    expect(fsEvent).toBeDefined()
    expect(fsEvent!.delta.length).toBeGreaterThan(0)
    const fsUpsert = fsEvent!.delta.find(d => d.type === 'UpsertNode')
    expect(fsUpsert).toBeDefined()
    if (fsUpsert?.type !== 'UpsertNode') throw new Error('Expected UpsertNode')
    expect(fsUpsert.nodeToUpsert.nodeUIMetadata.additionalYAMLProps).toMatchObject({
      agent_name: 'Ari',
    })
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
