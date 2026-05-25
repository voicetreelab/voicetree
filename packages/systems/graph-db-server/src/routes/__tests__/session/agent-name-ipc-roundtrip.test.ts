/**
 * End-to-end test: a delta POSTed to the daemon with `agent_name` in
 * `additionalYAMLProps` results in the persisted file frontmatter containing
 * `agent_name: Ari`. Regression guard for the prior Map-serialization bug
 * (now fixed by representing additionalYAMLProps as a plain Record).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphDbClient } from '@vt/graph-db-client'
import { type DaemonHandle, startDaemon } from '../../../daemon/server.ts'
import { resetUndoState } from '../../../state/undo-store.ts'

async function withTempVault(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'graphd-agentname-test-'))
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(join(tmpdir(), 'graphd-agentname-appsupport-'))
  const config = {
    vaultConfig: {
      [vault]: { writeFolder: vault },
    },
  }
  await writeFile(join(appSupport, 'voicetree-config.json'), JSON.stringify(config))
  return appSupport
}

describe('agent_name survives IPC roundtrip to daemon', () => {
  let vault: string
  let appSupport: string
  let handles: DaemonHandle[]

  beforeEach(async () => {
    vault = await withTempVault()
    appSupport = await createAppSupport(vault)
    handles = []
    resetUndoState()
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    await rm(vault, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15000)

  test('agent_name in additionalYAMLProps persists to disk frontmatter', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
    handles.push(handle)
    const testNodePath = join(vault, 'hello-from-ari.md')

    const delta: unknown[] = [
      {
        type: 'UpsertNode',
        nodeToUpsert: {
          kind: 'leaf',
          outgoingEdges: [],
          absoluteFilePathIsID: testNodePath,
          contentWithoutYamlOrLinks: '# Hello World (Sonnet)\nWork from Ari.',
          nodeUIMetadata: {
            color: { _tag: 'Some', value: 'green' },
            position: { _tag: 'None' },
            additionalYAMLProps: { agent_name: 'Ari' },
            isContextNode: false,
          },
        },
        previousNode: { _tag: 'None' },
      },
    ]

    // Use the real GraphDbClient — same code path as the MCP create_graph tool.
    const client = new GraphDbClient({
      baseUrl: `http://127.0.0.1:${handle.port}`,
      sessionId: 'mcp-roundtrip-session',
    })
    await client.applyGraphDelta(delta, {
      recordForUndo: false,
      sessionId: 'mcp-roundtrip-session',
    })

    const fileContent: string = await readFile(testNodePath, 'utf8')
    expect(fileContent).toContain('agent_name: Ari')
  }, 20000)
})
