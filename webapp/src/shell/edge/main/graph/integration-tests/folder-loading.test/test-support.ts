import { expect, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta } from '@vt/graph-model/graph'
import type { BrowserWindow } from 'electron'
import { createGraph } from '@vt/graph-model/graph'
import { initGraphModel } from '@vt/graph-model'
import { GraphDbClient } from '@vt/graph-db-client'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearRecentDeltas } from '@vt/graph-db-server/state/recent-deltas-store'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { handleFSEventWithStateAndUISides } from '@vt/graph-db-server/graph/handleFSEvent'
import { EXAMPLE_SMALL_PATH, EXAMPLE_LARGE_PATH } from '@/utils/test-utils/fixture-paths'
import { waitForCondition } from '@/utils/test-utils/waitForCondition'
import {
  loadFolder,
  stopFileWatching,
  getProjectRoot,
  setProjectRoot
} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { clearDaemonClientCache } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'

export interface BroadcastCall {
  readonly channel: string
  readonly delta: GraphDelta
}

export type MockMainWindow = {
  readonly webContents: {
    readonly send: (channel: string, data: GraphDelta) => void
    readonly isDestroyed: () => boolean
  }
  readonly isDestroyed: () => boolean
}

export interface FixtureEnvironment {
  readonly tempRoot: string
  readonly exampleSmallPath: string
  readonly exampleLargePath: string
}

export const MIN_SMALL_NODE_COUNT: 10 = 10 as const
export const MIN_LARGE_NODE_COUNT: 75 = 75 as const
export const INTEGRATION_TEST_TIMEOUT_MS: 30000 = 30000 as const

export async function createFixtureEnvironment(): Promise<FixtureEnvironment> {
  const tempRoot: string = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-loading-fixtures-'))

  return {
    tempRoot,
    exampleSmallPath: await copyFixtureToTemp(tempRoot, EXAMPLE_SMALL_PATH, 'example_small'),
    exampleLargePath: await copyFixtureToTemp(tempRoot, EXAMPLE_LARGE_PATH, 'example_real_large')
  }
}

export async function prepareFolderLoadingTest(
  environment: FixtureEnvironment,
  recordBroadcast: (call: BroadcastCall) => void
): Promise<MockMainWindow> {
  await new Promise(resolve => setTimeout(resolve, 500))

  initGraphModel(
    { appSupportPath: path.join(environment.tempRoot, 'app-support') },
    {
      onGraphCleared: (): void => {
        recordBroadcast({ channel: 'graph:clear', delta: [] })
      },
      onWatchingStarted: (): void => {
        recordBroadcast({ channel: 'watching-started', delta: [] })
      }
    }
  )

  setGraph(createGraph({}))
  setProjectRoot('')

  await saveVaultConfigForDirectory(environment.exampleSmallPath, {
    writeFolder: path.join(environment.exampleSmallPath, 'voicetree')
  })
  await saveVaultConfigForDirectory(environment.exampleLargePath, {
    writeFolder: path.join(environment.exampleLargePath, 'voicetree')
  })

  await removeTestMarkdownFiles(environment.exampleSmallPath)
  clearRecentDeltas()
  await removeCtxNodeDirectories(environment.exampleSmallPath)

  return createMockMainWindow(recordBroadcast)
}

export async function cleanupFolderLoadingTest(environment: FixtureEnvironment): Promise<void> {
  await stopFileWatching()
  await removeTestMarkdownFiles(environment.exampleSmallPath)
  await removeCtxNodeDirectories(environment.exampleSmallPath)
  vi.clearAllMocks()
}

export async function disposeFixtureEnvironment(environment: FixtureEnvironment): Promise<void> {
  await Promise.all([
    shutdownDaemonForVault(environment.exampleSmallPath),
    shutdownDaemonForVault(environment.exampleLargePath)
  ])
  clearDaemonClientCache()
  await fs.rm(environment.tempRoot, { recursive: true, force: true })
}

export async function loadFixtureFolder(folderPath: string): Promise<void> {
  await loadFolder(folderPath, { includeActiveViewExpandedPaths: false })
  await waitForCondition(
    () => Object.keys(getGraph().nodes).some(nodePath => nodePath.startsWith(`${folderPath}${path.sep}`)),
    { maxWaitMs: 10000, errorMessage: `Graph did not populate for loaded fixture folder: ${folderPath}` }
  )
}

export function expectWatchedDirectory(expected: string): void {
  const projectRoot: O.Option<string> = getProjectRoot()
  expect(O.isSome(projectRoot)).toBe(true)
  if (O.isSome(projectRoot)) {
    expect(projectRoot.value).toBe(expected)
  }
}

export function getGraphBroadcasts(broadcastCalls: readonly BroadcastCall[]): BroadcastCall[] {
  return broadcastCalls.filter(call =>
    ['graph:clear', 'graph:projectedGraphUpdate', 'watching-started'].includes(call.channel)
  )
}

export function expectLoadBroadcastSequence(graphBroadcasts: readonly BroadcastCall[]): void {
  expect(graphBroadcasts.length).toBe(3)
  expect(graphBroadcasts[0].channel).toBe('graph:clear')
  expect(graphBroadcasts[1].channel).toBe('graph:projectedGraphUpdate')
  expect(graphBroadcasts[1].delta).toBeDefined()
  expect(graphBroadcasts[2].channel).toBe('watching-started')
}

export async function expectLinkedFileAddDeleteViaFSEvent(
  exampleSmallPath: string,
  mockMainWindow: MockMainWindow,
  broadcastCalls: BroadcastCall[],
  minimumNodeCount: number
): Promise<void> {
  broadcastCalls.length = 0
  clearRecentDeltas()

  const testFilePath: string = path.join(exampleSmallPath, 'test-new-file.md')
  const testFileContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[[5_Immediate_Test_Observation_No_Output]]'
  const expectedContent: "# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*" = '# Test New File\n\nThis is a test file for chokidar detection.\n\n[5_Immediate_Test_Observation_No_Output]*'

  await addFileViaFSEvent(exampleSmallPath, testFilePath, testFileContent, mockMainWindow)

  const graphAfterAdd = getGraph()
  expect(graphAfterAdd.nodes[testFilePath]).toBeDefined()
  expect(graphAfterAdd.nodes[testFilePath].contentWithoutYamlOrLinks).toBe(expectedContent)
  expect(Object.keys(graphAfterAdd.nodes).length).toBeGreaterThanOrEqual(minimumNodeCount)

  const testNode = graphAfterAdd.nodes[testFilePath]
  expect(testNode.outgoingEdges).toBeDefined()
  expect(Array.isArray(testNode.outgoingEdges)).toBe(true)
  expect(testNode.outgoingEdges.some(edge => edge.targetId.includes('5_Immediate_Test_Observation_No_Output'))).toBe(true)

  const graphStateChangedBroadcasts: BroadcastCall[] = projectedGraphBroadcasts(broadcastCalls)
  if (graphStateChangedBroadcasts.length > 0) {
    const addBroadcast = graphStateChangedBroadcasts.find(call =>
      call.delta.some(delta => delta.type === 'UpsertNode' && delta.nodeToUpsert.absoluteFilePathIsID === testFilePath)
    )
    expect(addBroadcast).toBeDefined()
  }

  broadcastCalls.length = 0
  await deleteFileViaFSEvent(exampleSmallPath, testFilePath, mockMainWindow)

  expect(getGraph().nodes[testFilePath]).toBeUndefined()

  const deleteGraphStateChangedBroadcasts: BroadcastCall[] = projectedGraphBroadcasts(broadcastCalls)
  if (deleteGraphStateChangedBroadcasts.length > 0) {
    const deleteBroadcast = deleteGraphStateChangedBroadcasts.find(call =>
      call.delta.some(delta => delta.type === 'DeleteNode' && delta.nodeId === testFilePath)
    )
    expect(deleteBroadcast).toBeDefined()
  }
}

export async function expectSimpleFileAddDeleteViaFSEvent(
  exampleSmallPath: string,
  mockMainWindow: MockMainWindow,
  broadcastCalls: BroadcastCall[]
): Promise<void> {
  const newFilePath: string = path.join(exampleSmallPath, 'test-new-file-simple.md')
  const newFileContent: "# Test New File\n\nThis is a test." = '# Test New File\n\nThis is a test.'

  await addFileViaFSEvent(exampleSmallPath, newFilePath, newFileContent, mockMainWindow, () =>
    projectedGraphBroadcasts(broadcastCalls).length > 0
  )

  expect(getGraph().nodes[newFilePath]).toBeDefined()
  expect(getGraph().nodes[newFilePath].contentWithoutYamlOrLinks).toBe(newFileContent)

  const stateChangedBroadcasts: BroadcastCall[] = projectedGraphBroadcasts(broadcastCalls)
  expect(stateChangedBroadcasts.length).toBeGreaterThanOrEqual(1)
  expect(stateChangedBroadcasts[0].channel).toBe('graph:projectedGraphUpdate')
  expect(stateChangedBroadcasts[0].delta.find(delta => delta.type === 'UpsertNode')).toBeDefined()

  broadcastCalls.length = 0
  await deleteFileViaFSEvent(exampleSmallPath, newFilePath, mockMainWindow, () =>
    projectedGraphBroadcasts(broadcastCalls).length > 0
  )

  expect(getGraph().nodes[newFilePath]).toBeUndefined()

  const deleteStateChangedBroadcasts: BroadcastCall[] = projectedGraphBroadcasts(broadcastCalls)
  expect(deleteStateChangedBroadcasts.length).toBeGreaterThanOrEqual(1)
  expect(deleteStateChangedBroadcasts[0].channel).toBe('graph:projectedGraphUpdate')
  expect(deleteStateChangedBroadcasts[0].delta.find(delta => delta.type === 'DeleteNode')).toBeDefined()
}

function createMockMainWindow(recordBroadcast: (call: BroadcastCall) => void): MockMainWindow {
  return {
    webContents: {
      send: vi.fn((channel: string, data: GraphDelta) => {
        recordBroadcast({ channel, delta: data })
      }),
      isDestroyed: vi.fn(() => false)
    },
    isDestroyed: vi.fn(() => false)
  }
}

async function copyFixtureToTemp(
  tempRoot: string,
  sourcePath: string,
  destinationName: string
): Promise<string> {
  const destinationPath: string = path.join(tempRoot, destinationName)
  await fs.cp(sourcePath, destinationPath, { recursive: true })
  await Promise.all([
    fs.rm(path.join(destinationPath, '.voicetree', 'graphd.port'), { force: true }),
    fs.rm(path.join(destinationPath, '.voicetree', 'graphd.lock'), { force: true })
  ])
  return destinationPath
}

async function shutdownDaemonForVault(projectRoot: string): Promise<void> {
  const client: GraphDbClient | null = await GraphDbClient.connect({ vault: projectRoot }).catch(() => null)
  await client?.shutdown().catch(() => undefined)
}

async function removeTestMarkdownFiles(exampleSmallPath: string): Promise<void> {
  for (const testFilePath of testMarkdownFiles(exampleSmallPath)) {
    await fs.unlink(testFilePath).catch(() => undefined)
  }
}

async function removeCtxNodeDirectories(exampleSmallPath: string): Promise<void> {
  for (const ctxNodesPath of ctxNodeDirectories(exampleSmallPath)) {
    await fs.rm(ctxNodesPath, { recursive: true, force: true })
  }
}

function testMarkdownFiles(exampleSmallPath: string): string[] {
  return [
    path.join(exampleSmallPath, 'test-new-file.md'),
    path.join(exampleSmallPath, 'test-new-file-simple.md'),
    path.join(exampleSmallPath, 'voicetree', 'test-new-file.md'),
    path.join(exampleSmallPath, 'voicetree', 'test-new-file-simple.md')
  ]
}

function ctxNodeDirectories(exampleSmallPath: string): string[] {
  return [
    path.join(exampleSmallPath, 'ctx-nodes'),
    path.join(exampleSmallPath, 'voicetree', 'ctx-nodes')
  ]
}

async function addFileViaFSEvent(
  vaultPath: string,
  absolutePath: string,
  content: string,
  mainWindow: MockMainWindow,
  additionalCompletionCheck: () => boolean = () => true
): Promise<void> {
  await fs.writeFile(absolutePath, content, 'utf-8')
  handleFSEventWithStateAndUISides(
    { absolutePath, content, eventType: 'Added' as const },
    vaultPath,
    mainWindow as unknown as BrowserWindow
  )
  await waitForCondition(
    () => !!getGraph().nodes[absolutePath] && additionalCompletionCheck(),
    { maxWaitMs: 5000, errorMessage: 'test-new-file node not added to graph via handleFSEvent' }
  )
}

async function deleteFileViaFSEvent(
  vaultPath: string,
  absolutePath: string,
  mainWindow: MockMainWindow,
  additionalCompletionCheck: () => boolean = () => true
): Promise<void> {
  await fs.unlink(absolutePath)
  handleFSEventWithStateAndUISides(
    { type: 'Delete' as const, absolutePath },
    vaultPath,
    mainWindow as unknown as BrowserWindow
  )
  await waitForCondition(
    () => !getGraph().nodes[absolutePath] && additionalCompletionCheck(),
    { maxWaitMs: 5000, errorMessage: 'test-new-file node not removed from graph via handleFSEvent' }
  )
}

function projectedGraphBroadcasts(broadcastCalls: readonly BroadcastCall[]): BroadcastCall[] {
  return broadcastCalls.filter(call => call.channel === 'graph:projectedGraphUpdate')
}
