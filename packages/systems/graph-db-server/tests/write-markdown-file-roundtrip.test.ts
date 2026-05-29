import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createEmptyGraph, type GraphNode } from '@vt/graph-model'
import type { ProjectedGraph } from '@vt/graph-state/contract'

import { SessionCreateResponseSchema } from '@vt/graph-db-server/contract'
import { startDaemon, type DaemonHandle } from '../src/daemon/index.ts'
import { setGraph } from '../src/state/graph-store.ts'
import { clearWatchFolderState } from '../src/state/watch-folder-store.ts'

type GraphResponse = {
  readonly nodes: Record<string, GraphNode>
}

const ROUNDTRIP_TIMEOUT_MS = 2000

function parseSSEGraphEvents(text: string): readonly ProjectedGraph[] {
  const graphs: ProjectedGraph[] = []
  for (const block of text.split('\n\n').filter(Boolean)) {
    if (!block.includes('event: projectedGraph')) continue
    const dataLine = block.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) continue
    graphs.push(JSON.parse(dataLine.slice('data:'.length).trim()))
  }
  return graphs
}

async function readProjectedGraphsUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (graphs: readonly ProjectedGraph[]) => boolean,
): Promise<{ readonly graphs: readonly ProjectedGraph[]; readonly elapsedMs: number }> {
  const decoder = new TextDecoder()
  const graphs: ProjectedGraph[] = []
  let buffered = ''
  const startedAt = performance.now()
  const deadline = Date.now() + ROUNDTRIP_TIMEOUT_MS

  while (Date.now() < deadline) {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Timed out waiting for projectedGraph SSE event after ${ROUNDTRIP_TIMEOUT_MS}ms`)),
        deadline - Date.now(),
      )
    })
    const result = await Promise.race([reader.read(), timeout])

    if (result.done) break
    buffered += decoder.decode(result.value, { stream: true })
    const blocks = buffered.split('\n\n')
    buffered = blocks.pop() ?? ''
    graphs.push(...parseSSEGraphEvents(blocks.join('\n\n') + '\n\n'))
    if (predicate(graphs)) {
      return { graphs, elapsedMs: performance.now() - startedAt }
    }
  }

  throw new Error(`Timed out waiting for projectedGraph SSE event after ${ROUNDTRIP_TIMEOUT_MS}ms`)
}

function graphContainsSuppressedRecentNode(
  nodeId: string,
): (graphs: readonly ProjectedGraph[]) => boolean {
  return graphs => graphs.some(graph =>
    graph.recentNodeIds.includes(nodeId) &&
    graph.suppressForSubscribers?.includes('test-editor-1') === true,
  )
}

async function createAppSupport(vault: string): Promise<string> {
  const appSupport = await mkdtemp(path.join(tmpdir(), 'graphd-write-md-appsupport-'))
  await writeFile(
    path.join(appSupport, 'voicetree-config.json'),
    JSON.stringify({ vaultConfig: { [vault]: { writeFolderPath: vault } } }),
  )
  return appSupport
}

async function createSessionEventsReader(
  baseUrl: string,
  controllers: AbortController[],
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const createRes = await fetch(`${baseUrl}/sessions`, { method: 'POST' })
  expect(createRes.status).toBe(201)
  const { sessionId } = SessionCreateResponseSchema.parse(await createRes.json())

  const controller = new AbortController()
  controllers.push(controller)
  const eventsRes = await fetch(`${baseUrl}/sessions/${sessionId}/events`, {
    signal: controller.signal,
  })
  expect(eventsRes.status).toBe(200)
  const reader = eventsRes.body!.getReader()
  await reader.read()
  return reader
}

async function postWriteMarkdownFile(
  baseUrl: string,
  absolutePath: string,
  body: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/graph/write-markdown-file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      absolutePath,
      body,
      editorId: 'test-editor-1',
    }),
  })
  expect(response.status).toBe(200)
  const payload = await response.json() as { readonly absolutePath: string }
  return payload.absolutePath
}

async function readGraph(baseUrl: string): Promise<GraphResponse> {
  return await (await fetch(`${baseUrl}/graph`)).json() as GraphResponse
}

describe('write-markdown-file daemon roundtrip', () => {
  let root: string
  let vault: string
  let appSupport: string
  let handle: DaemonHandle | null
  let controllers: AbortController[]

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'graphd-write-md-roundtrip-'))
    vault = path.join(root, 'vault')
    await mkdir(vault, { recursive: true })
    appSupport = await createAppSupport(vault)
    handle = null
    controllers = []
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    for (const controller of controllers) controller.abort()
    await new Promise(resolve => setTimeout(resolve, 50))
    await handle?.stop().catch(() => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
    await rm(appSupport, { recursive: true, force: true })
  }, 15000)

  async function start(): Promise<string> {
    handle = await startDaemon({
      vault,
      voicetreeHomePath: appSupport,
      createStarterIfEmpty: false,
    })
    return `http://127.0.0.1:${handle.port}`
  }

  test('preserves existing frontmatter and broadcasts a suppressed change event', async () => {
    const notePath = path.join(vault, 'frontmatter.md')
    const frontmatter = '---\nposition:\n  x: 10\n  y: 20\ncolor: blue\n---\n'
    const body = '# New body\n\nChanged through endpoint.\n'
    await writeFile(notePath, `${frontmatter}# Old body\n`, 'utf8')

    const baseUrl = await start()
    const reader = await createSessionEventsReader(baseUrl, controllers)

    const actualPath = await postWriteMarkdownFile(baseUrl, notePath, body)
    expect(actualPath).toBe(notePath)
    expect((await readGraph(baseUrl)).nodes[notePath].contentWithoutYamlOrLinks).toBe(body)

    const { elapsedMs } = await readProjectedGraphsUntil(reader, graphContainsSuppressedRecentNode(notePath))
    expect(elapsedMs).toBeLessThanOrEqual(ROUNDTRIP_TIMEOUT_MS)
    await expect(readFile(notePath, 'utf8')).resolves.toBe(`${frontmatter}${body}`)
    expect((await readGraph(baseUrl)).nodes[notePath].contentWithoutYamlOrLinks).toBe(body)
  }, 15000)

  test('updates an existing markdown file with no frontmatter', async () => {
    const notePath = path.join(vault, 'plain.md')
    const body = '# Plain new body\n\nNo frontmatter.\n'
    await writeFile(notePath, '# Plain old body\n', 'utf8')

    const baseUrl = await start()
    const reader = await createSessionEventsReader(baseUrl, controllers)

    await postWriteMarkdownFile(baseUrl, notePath, body)

    await readProjectedGraphsUntil(reader, graphContainsSuppressedRecentNode(notePath))
    await expect(readFile(notePath, 'utf8')).resolves.toBe(body)
    expect((await readGraph(baseUrl)).nodes[notePath].contentWithoutYamlOrLinks).toBe(body)
  }, 15000)

  test('creates a new markdown file through the watcher path', async () => {
    const notePath = path.join(vault, 'new-node.md')
    const body = '# New node\n\nCreated through endpoint.\n'

    const baseUrl = await start()
    const reader = await createSessionEventsReader(baseUrl, controllers)

    const actualPath = await postWriteMarkdownFile(baseUrl, notePath, body)
    expect(actualPath).toBe(notePath)

    await readProjectedGraphsUntil(reader, graphContainsSuppressedRecentNode(notePath))
    await expect(readFile(notePath, 'utf8')).resolves.toBe(body)
    expect((await readGraph(baseUrl)).nodes[notePath].contentWithoutYamlOrLinks).toBe(body)
  }, 15000)

  test('resolves a folder node save to index.md and broadcasts that node', async () => {
    const folderPath = path.join(vault, 'folder-node')
    const indexPath = path.join(folderPath, 'index.md')
    const body = '# Folder body\n\nSaved via folder node path.\n'
    await mkdir(folderPath, { recursive: true })

    const baseUrl = await start()
    const reader = await createSessionEventsReader(baseUrl, controllers)

    const actualPath = await postWriteMarkdownFile(baseUrl, `${folderPath}/`, body)
    expect(actualPath).toBe(indexPath)

    await readProjectedGraphsUntil(reader, graphContainsSuppressedRecentNode(indexPath))
    await expect(readFile(indexPath, 'utf8')).resolves.toBe(body)
    expect((await readGraph(baseUrl)).nodes[indexPath].contentWithoutYamlOrLinks).toBe(body)
  }, 15000)
})
