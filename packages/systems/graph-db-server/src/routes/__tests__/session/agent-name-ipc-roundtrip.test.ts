/**
 * Black-box TDD test for the bug: nodes created via the MCP `create_graph`
 * tool lose their `agent_name` in the on-disk frontmatter.
 *
 * Root cause hypothesis: the MCP server constructs each node with
 * `additionalYAMLProps` as a `Map<string, string>` (because that's what
 * `parseMarkdownToGraphNode` returns). When the delta is POSTed to the
 * graph-db-server daemon via JSON (see `GraphDbClient.applyGraphDelta`),
 * `JSON.stringify(new Map([...]))` collapses to `"{}"` — every entry is
 * silently dropped. The daemon then writes the file without `agent_name`.
 *
 * This test reproduces that scenario end-to-end by POSTing a delta whose
 * `additionalYAMLProps` is a JS Map (matching the exact shape the MCP
 * server constructs), then asserts the persisted file frontmatter contains
 * `agent_name: Ari`.
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

  test('agent_name in additionalYAMLProps Map persists to disk frontmatter', async () => {
    const handle = await startDaemon({ vault, appSupportPath: appSupport })
    handles.push(handle)
    const testNodePath = join(vault, 'hello-from-ari.md')

    // Construct the delta exactly the way the MCP create_graph tool does:
    // additionalYAMLProps is a *Map* (from parseMarkdownToGraphNode).
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
            additionalYAMLProps: new Map([['agent_name', 'Ari']]),
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
