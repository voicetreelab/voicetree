import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearWatchFolderState,
  createEmptyGraph,
  initGraphModel,
  saveVaultConfigForDirectory,
  setGraph,
} from '@vt/graph-model'
import { startDaemon, type DaemonHandle } from '../server.ts'

type Harness = {
  appSupportPath: string
  root: string
  vault: string
  writePath: string
}

async function createHarness(readPaths: readonly string[] = []): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'graphd-bf212-routes-'))
  const appSupportPath = join(root, 'app-support')
  const vault = join(root, 'vault')
  const writePath = join(vault, 'write')

  await mkdir(appSupportPath, { recursive: true })
  await mkdir(writePath, { recursive: true })
  for (const readPath of readPaths) {
    await mkdir(readPath, { recursive: true })
  }

  initGraphModel({ appSupportPath })
  clearWatchFolderState()
  setGraph(createEmptyGraph())
  process.env.VOICETREE_APP_SUPPORT = appSupportPath

  await saveVaultConfigForDirectory(vault, {
    writePath,
    readPaths,
  })

  return { appSupportPath, root, vault, writePath }
}

async function waitFor<T>(
  fn: () => Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 2000
  const intervalMs = opts.intervalMs ?? 50
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = await fn()
    if (value !== null) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`condition not met within ${timeoutMs}ms`)
}

describe('GET /graph', () => {
  let handles: DaemonHandle[]
  let rootsToDelete: string[]

  beforeEach(() => {
    handles = []
    rootsToDelete = []
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    for (const root of rootsToDelete) {
      await rm(root, { recursive: true, force: true })
    }
    delete process.env.VOICETREE_APP_SUPPORT
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  test('returns the current graph JSON payload', async () => {
    const harness = await createHarness()
    rootsToDelete.push(harness.root)

    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const response = await fetch(`http://127.0.0.1:${handle.port}/graph`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      nodes: {},
    })
  })

  test('includes a newly written markdown file from an existing read path', async () => {
    const readPath = join(await mkdtemp(join(tmpdir(), 'graphd-bf212-readpath-')), 'docs')
    const harness = await createHarness([readPath])
    rootsToDelete.push(harness.root)
    rootsToDelete.push(join(readPath, '..'))

    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const filePath = join(readPath, 'foo.md')
    await writeFile(filePath, '# Foo\n\nwatch me\n', 'utf8')

    const graph = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${handle.port}/graph`)
      if (!response.ok) {
        return null
      }
      const body = (await response.json()) as {
        nodes?: Record<string, { contentWithoutYamlOrLinks?: string }>
      }
      return body.nodes?.[filePath] ? body : null
    })

    expect(graph.nodes?.[filePath]?.contentWithoutYamlOrLinks).toContain('watch me')
  })
})
