import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DaemonHandle, startDaemon } from '../server.ts'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-delta-test-'))
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(join(tmpdir(), 'graphd-delta-appsupport-'))
  const config = {
    vaultConfig: {
      [vault]: { writePath: vault },
    },
  }
  await writeFile(join(appSupport, 'voicetree-config.json'), JSON.stringify(config))
  return appSupport
}

describe('HTTP graph delta writes', () => {
  let vault: string
  let appSupport: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await withTempVault()
    appSupport = await createAppSupport(vault)
    handles = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15000)

  test('applies a session-tagged delta and returns the updated graph', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
    handles.push(handle)
    const base = `http://127.0.0.1:${handle.port}`
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

    const res = await fetch(`${base}/graph/delta`, {
      body: JSON.stringify(delta),
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': 'renderer-session-123',
      },
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.delta).toEqual(delta)
    expect(body.graph.nodes[testNodePath]).toBeDefined()
    expect(body.graph.nodes[testNodePath].absoluteFilePathIsID).toBe(testNodePath)

    await expect(readFile(testNodePath, 'utf8')).resolves.toContain(
      '# Test HTTP Node',
    )
  }, 20000)

  test('rejects invalid graph delta payloads', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
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
