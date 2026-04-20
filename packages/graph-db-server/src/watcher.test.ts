import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addReadPath,
  clearWatchFolderState,
  createEmptyGraph,
  initGraphModel,
  removeReadPath,
  saveVaultConfigForDirectory,
  setGraph,
} from '@vt/graph-model'
import { readPortFile } from './portFile.ts'
import { startDaemon, type DaemonHandle } from './server.ts'

type Harness = {
  appSupportPath: string
  root: string
  vault: string
  writePath: string
}

type GraphResponse = {
  nodes: Record<string, { contentWithoutYamlOrLinks?: string }>
}

function getActiveHandles(): unknown[] {
  return (process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[]
  })._getActiveHandles?.() ?? []
}

async function createHarness(readPaths: readonly string[] = []): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'graphd-bf212-watcher-'))
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

async function fetchGraph(port: number): Promise<GraphResponse | null> {
  const response = await fetch(`http://127.0.0.1:${port}/graph`)
  if (!response.ok) {
    return null
  }
  return (await response.json()) as GraphResponse
}

async function waitForNode(port: number, nodeId: string): Promise<GraphResponse> {
  return await waitFor(async () => {
    const graph = await fetchGraph(port)
    return graph?.nodes[nodeId] ? graph : null
  })
}

async function waitForNodeToDisappear(port: number, nodeId: string): Promise<GraphResponse> {
  return await waitFor(async () => {
    const graph = await fetchGraph(port)
    return graph && !graph.nodes[nodeId] ? graph : null
  })
}

async function expectNodeNeverAppears(port: number, nodeId: string, durationMs = 1200): Promise<void> {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    const graph = await fetchGraph(port)
    if (graph?.nodes[nodeId]) {
      throw new Error(`node unexpectedly appeared in graph: ${nodeId}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
}

describe('daemon watcher remounts', () => {
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

  test('starts watching a read path added at runtime', async () => {
    const harness = await createHarness()
    rootsToDelete.push(harness.root)

    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const extraReadPath = join(harness.vault, 'extra')
    const addResult = await addReadPath(extraReadPath)

    expect(addResult.success).toBe(true)

    const filePath = join(extraReadPath, 'bar.md')
    await writeFile(filePath, '# Bar\n\nruntime add\n', 'utf8')

    const graph = await waitForNode(handle.port, filePath)
    expect(graph.nodes[filePath]?.contentWithoutYamlOrLinks).toContain('runtime add')
  })

  test('stops watching a read path removed at runtime', async () => {
    const alpha = join(await mkdtemp(join(tmpdir(), 'graphd-bf212-alpha-')), 'alpha')
    const beta = join(await mkdtemp(join(tmpdir(), 'graphd-bf212-beta-')), 'beta')
    const harness = await createHarness([alpha, beta])
    rootsToDelete.push(harness.root)
    rootsToDelete.push(join(alpha, '..'))
    rootsToDelete.push(join(beta, '..'))

    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const firstFile = join(alpha, 'before-remove.md')
    await writeFile(firstFile, '# Before Remove\n\nalpha live\n', 'utf8')
    await waitForNode(handle.port, firstFile)

    const removeResult = await removeReadPath(alpha)
    expect(removeResult.success).toBe(true)

    await waitForNodeToDisappear(handle.port, firstFile)

    const secondFile = join(alpha, 'after-remove.md')
    await writeFile(secondFile, '# After Remove\n\nshould stay hidden\n', 'utf8')
    await expectNodeNeverAppears(handle.port, secondFile)
  })

  test('shutdown cleans up daemon-owned watcher handles after the watcher has been exercised', async () => {
    const docs = join(await mkdtemp(join(tmpdir(), 'graphd-bf212-docs-')), 'docs')
    const harness = await createHarness([docs])
    rootsToDelete.push(harness.root)
    rootsToDelete.push(join(docs, '..'))

    const baselineHandles = new Set(getActiveHandles())
    const handle = await startDaemon({ vault: harness.vault })
    handles.push(handle)

    const filePath = join(docs, 'shutdown-proof.md')
    await writeFile(filePath, '# Shutdown Proof\n\nwatcher is live\n', 'utf8')
    await waitForNode(handle.port, filePath)

    const activeDuringRun = getActiveHandles().filter((entry) => !baselineHandles.has(entry))
    expect(activeDuringRun.length).toBeGreaterThan(0)

    const response = await fetch(`http://127.0.0.1:${handle.port}/shutdown`, {
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    await waitFor(async () => {
      const remaining = getActiveHandles().filter((entry) => !baselineHandles.has(entry))
      return remaining.length === 0 ? remaining : null
    }, { timeoutMs: 2000 })

    await waitFor(async () => ((await readPortFile(harness.vault)) === null ? true : null))
    handles = []
  })
})
