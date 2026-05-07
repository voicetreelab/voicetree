import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const GRAPH_DB_SERVER_RESTRICTED_IMPORT_MESSAGE =
  "'@vt/graph-db-server/state/graph-store' import is restricted from being used by a pattern. Do not import graph-db-server internals directly. Use @vt/graph-db-client, @vt/graph-db-server/contract, the package root daemon API, or the daemonRouteParity tooling module."

const srcDir: string = path.dirname(fileURLToPath(import.meta.url))
const webappDir: string = path.resolve(srcDir, '..')
const repoRootDir: string = path.resolve(webappDir, '..')
const configPath: string = path.join(webappDir, 'eslint.config.js')
const ESLINT_INTEGRATION_TIMEOUT_MS: number = 60_000

async function lintText(
  code: string,
  relativeFilePath: string,
): Promise<readonly string[]> {
  const absoluteFilePath: string = path.join(repoRootDir, relativeFilePath)
  const eslint: ESLint = new ESLint({
    cwd: repoRootDir,
    overrideConfigFile: configPath,
  })

  await mkdir(path.dirname(absoluteFilePath), { recursive: true })
  await writeFile(absoluteFilePath, code)

  try {
    const [result] = await eslint.lintFiles([absoluteFilePath])
    return result.messages.map(message => message.message)
  } finally {
    await rm(absoluteFilePath, { force: true })
  }
}

describe('daemon mutation import lint rule', () => {
  it('allows daemon package callers to import daemon-owned mutation functions', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { addReadPath, removeReadPath, setWritePath } from '@vt/graph-model'
        import { dispatchCollapse, dispatchExpand } from '@vt/graph-state/state/collapseSetStore'
      `,
      'packages/systems/graph-db-server/src/__generated__/allowed-daemon-imports.ts',
    )

    expect(messages).toEqual([])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('rejects direct imports and re-exports outside the daemon package', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { addReadPath } from '@vt/graph-model'
        export { dispatchCollapse } from '@vt/graph-state/state/collapseSetStore'
        void addReadPath
      `,
      'webapp/src/__generated__/bad-daemon-imports.ts',
    )

    expect(messages).toEqual([
      'addReadPath is daemon-owned. Route it through packages/systems/graph-db-server or a daemon/session-backed main API path.',
      'dispatchCollapse is daemon-owned. Route it through packages/systems/graph-db-server or a daemon/session-backed main API path.',
    ])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('allows explicitly annotated low-level tests', async () => {
    const messages: readonly string[] = await lintText(
      `
        /* vt-allow-direct-daemon-mutation-import: exercising primitive behaviour directly */
        import { setWritePath } from '@vt/graph-model'
        import { dispatchExpand } from '@vt/graph-state/state/collapseSetStore'
        void setWritePath
        void dispatchExpand
      `,
      'webapp/src/__generated__/primitive-boundary.test.ts',
    )

    expect(messages).toEqual([])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('allows the narrow fixture path escape hatch', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { removeReadPath } from '@vt/graph-model'
        void removeReadPath
      `,
      'webapp/src/__fixtures__/allowed-daemon-mutation-imports/sample.ts',
    )

    expect(messages).toEqual([])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('warns on direct graph-db-server implementation imports in webapp code', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { getGraph } from '@vt/graph-db-server/state/graph-store'
        void getGraph
      `,
      'webapp/src/__generated__/bad-graph-db-server-import.ts',
    )

    expect(messages).toEqual([
      GRAPH_DB_SERVER_RESTRICTED_IMPORT_MESSAGE,
    ])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('allows graph-db-server root, contract, and daemon route parity imports', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { startDaemon } from '@vt/graph-db-server'
        import type { GraphState } from '@vt/graph-db-server/contract'
        import type { DaemonRouteId } from '@vt/graph-db-server/daemonRouteParity'
        declare const used: GraphState | DaemonRouteId
        void startDaemon
        void used
      `,
      'webapp/src/__generated__/allowed-graph-db-server-imports.ts',
    )

    expect(messages).toEqual([])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)

  it('warns on direct graph-db-server implementation imports in daemon consumers', async () => {
    const messages: readonly string[] = await lintText(
      `
        import { getGraph } from '@vt/graph-db-server/state/graph-store'
        void getGraph
      `,
      'packages/systems/voicetree-mcp/src/__generated__/bad-graph-db-server-import.ts',
    )

    expect(messages).toEqual([
      GRAPH_DB_SERVER_RESTRICTED_IMPORT_MESSAGE,
    ])
  }, ESLINT_INTEGRATION_TIMEOUT_MS)
})
