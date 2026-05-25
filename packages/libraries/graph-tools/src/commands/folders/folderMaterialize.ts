import fs from 'node:fs/promises'
import path from 'node:path'

import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { err, ok } from '@vt/graph-tools/debug/protocol/Response'
import { openDebugSession, type PageLike as SessionPageLike } from '@vt/graph-tools/debug/protocol/playwrightSession'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'
import {
  consumeDebugTargetFlag,
  parseIntegerFlag,
  readFlagValue,
  type DebugTargetArgs,
} from '../core/argv'
import { registerCommand } from '../index'

interface PageLike extends SessionPageLike {
  mouse: {
    click(x: number, y: number): Promise<void>
  }
}

type FloatingEditorRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  intersectsViewport: boolean
}

type DomProbes = {
  cyNodeCount: number
  floatingEditors: string[]
  floatingEditorRects: FloatingEditorRect[]
  selectedNodeHasEditor: boolean
}

type TapNodePlan =
  | { ok: true; strategy: 'mouse'; x: number; y: number }
  | { ok: true; strategy: 'emit' }
  | { ok: false; error: string }

export type FolderMaterializeOptions = {
  folder?: string
  keepFixture: boolean
  marker?: string
  pid?: number
  port?: number
  timeoutMs: number
  vault?: string
}

export type ScratchFixture = {
  folderId: string
  folderPath: string
  seedFilePath: string
}

export type FolderMaterializeResult = {
  cleanupError?: string
  cleanupPerformed: boolean
  cdpPort: number
  domProbesAfterTap: DomProbes
  domProbesAfterType: DomProbes
  domProbesBeforeTap: DomProbes
  editorSelector: string
  editorWindowId: string
  fixtureCreated: boolean
  folderId: string
  indexExistedBefore: boolean
  indexPath: string
  marker: string
  materializedNow: boolean
  mcpPort: number
  pid: number
  savedContentLength: number
  savedContentPreview: string
  seedFilePath?: string
  projectRoot: string
  writeFolder: string
}

const DEFAULT_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 200
const POST_TAP_WAIT_MS = 400
const POST_TYPE_WAIT_MS = 1_200

function usage(message?: string): Response<never> {
  return err(
    'folder-materialize',
    message ?? 'usage: vt-debug folder materialize [flags]',
    [
      '[--folder <absolute-folder-id>]',
      '[--marker <text>]',
      '[--timeout-ms <ms>]',
      '[--keep-fixture]',
      '[--port <n> | --cdpPort <n> | --pid <n> | --vault <path>]',
    ].join(' '),
  )
}

function withTrailingSlash(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`
}

function buildEditorWindowId(folderId: string): string {
  return `window-${folderId}-editor`
}

function buildEditorSelector(editorWindowId: string): string {
  return `[id=${JSON.stringify(editorWindowId)}] .cm-content`
}

function buildMarker(raw?: string): string {
  return raw?.trim() || `P7_FOLDER_MATERIALIZE_${Date.now()}`
}

function buildCheckpointText(marker: string): string {
  return `# VT Debug Folder Materialize\n\n${marker}\n`
}

function truncatePreview(value: string, maxLength = 160): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`
}

export function parseArgs(argv: string[]): FolderMaterializeOptions | Response<never> {
  let folder: string | undefined
  let keepFixture = false
  let marker: string | undefined
  let timeoutMs = DEFAULT_TIMEOUT_MS
  const target: DebugTargetArgs = {}

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--folder') {
        folder = path.resolve(readFlagValue('--folder', argv[++i]))
      } else if (arg.startsWith('--folder=')) {
        folder = path.resolve(readFlagValue('--folder', arg.slice('--folder='.length)))
      } else if (arg === '--marker') {
        marker = readFlagValue('--marker', argv[++i])
      } else if (arg.startsWith('--marker=')) {
        marker = readFlagValue('--marker', arg.slice('--marker='.length))
      } else if (arg === '--timeout-ms') {
        timeoutMs = parseIntegerFlag('--timeout-ms', argv[++i])
      } else if (arg.startsWith('--timeout-ms=')) {
        timeoutMs = parseIntegerFlag('--timeout-ms', arg.slice('--timeout-ms='.length))
      } else if (arg === '--keep-fixture') {
        keepFixture = true
      } else {
        const debugTargetFlag = consumeDebugTargetFlag(argv, i, target, { resolveVault: true })
        if (!debugTargetFlag.matched) {
          return usage(`unknown argument: ${arg}`)
        }
        i = debugTargetFlag.nextIndex
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (timeoutMs <= 0) {
    return usage('--timeout-ms must be > 0')
  }

  return {
    ...(folder ? { folder: withTrailingSlash(folder) } : {}),
    keepFixture,
    ...(marker ? { marker } : {}),
    ...(target.pid !== undefined ? { pid: target.pid } : {}),
    ...(target.port !== undefined ? { port: target.port } : {}),
    timeoutMs,
    ...(target.vault ? { vault: target.vault } : {}),
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined

  while (Date.now() <= deadline) {
    lastValue = await producer()
    if (predicate(lastValue)) {
      return lastValue
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`timed out waiting for ${description}`)
}

async function readWriteFolder(page: SessionPageLike): Promise<string> {
  const writeFolder = await page.evaluate(async () => {
    const raw = window.electronAPI?.main ? await window.electronAPI.main.getWriteFolder() : null
    if (typeof raw === 'string') return raw
    if (raw && typeof raw === 'object' && '_tag' in raw && (raw as { _tag?: unknown })._tag === 'Some') {
      const value = (raw as { value?: unknown }).value
      return typeof value === 'string' ? value : null
    }
    return null
  })

  if (typeof writeFolder !== 'string' || writeFolder.trim() === '') {
    throw new Error('window.electronAPI.main.getWriteFolder() unavailable')
  }

  return path.resolve(writeFolder)
}

export async function createScratchFixture(writeFolder: string): Promise<ScratchFixture> {
  const folderPath = await fs.mkdtemp(path.join(writeFolder, 'vt-debug-folder-materialize-'))
  const seedFilePath = path.join(folderPath, 'seed.md')
  await fs.writeFile(seedFilePath, '# Scratch Seed\n', 'utf8')
  return {
    folderId: withTrailingSlash(folderPath),
    folderPath,
    seedFilePath,
  }
}

async function waitForGraphReady(page: SessionPageLike, timeoutMs: number): Promise<string> {
  const state = await waitFor(
    () => page.evaluate(async () => {
      const cy = window.cytoscapeInstance
      const rawWriteFolder = window.electronAPI?.main ? await window.electronAPI.main.getWriteFolder() : null
      const writeFolder =
        typeof rawWriteFolder === 'string'
          ? rawWriteFolder
          : rawWriteFolder && typeof rawWriteFolder === 'object' && '_tag' in rawWriteFolder && (rawWriteFolder as { _tag?: unknown })._tag === 'Some'
            ? typeof (rawWriteFolder as { value?: unknown }).value === 'string'
              ? (rawWriteFolder as { value: string }).value
              : null
            : null
      return {
        cyNodeCount: typeof cy?.nodes === 'function' ? cy.nodes().length : 0,
        writeFolder,
      }
    }),
    value => value.cyNodeCount > 0 && typeof value.writeFolder === 'string' && value.writeFolder.length > 0,
    timeoutMs,
    'graph + write path readiness',
  )

  return path.resolve(state.writeFolder)
}

async function captureDomProbes(page: SessionPageLike): Promise<DomProbes> {
  return page.evaluate<DomProbes>(String.raw`(() => {
    const safe = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    const intersectsViewport = rect =>
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight

    const floatingEditorElements = Array.from(
      document.querySelectorAll('[id^="window-"][id$="-editor"]'),
    ).filter(element => element instanceof HTMLElement)

    const floatingEditorRects = floatingEditorElements.map(element => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.id,
        x: safe(rect.left),
        y: safe(rect.top),
        w: safe(rect.width),
        h: safe(rect.height),
        intersectsViewport: intersectsViewport(rect),
      }
    })

    const rectById = new Map(floatingEditorRects.map(rect => [rect.id, rect]))
    const selectedNodeIds =
      typeof window.cytoscapeInstance?.$ === 'function'
        ? window.cytoscapeInstance.$(':selected').map(node => node.id())
        : []

    return {
      cyNodeCount:
        typeof window.cytoscapeInstance?.nodes === 'function'
          ? window.cytoscapeInstance.nodes().length
          : 0,
      floatingEditors: floatingEditorElements.map(element => element.id),
      floatingEditorRects,
      selectedNodeHasEditor:
        selectedNodeIds.length > 0 &&
        selectedNodeIds.every(nodeId => rectById.get('window-' + nodeId + '-editor')?.intersectsViewport === true),
    }
  })()`)
}

async function waitForFolderNode(page: SessionPageLike, folderId: string, timeoutMs: number): Promise<void> {
  await waitFor(
    () => page.evaluate((targetId: string) => {
      const cy = window.cytoscapeInstance
      if (!cy || typeof cy.getElementById !== 'function') return false
      const node = cy.getElementById(targetId)
      return typeof node.length === 'number' && node.length > 0
    }, folderId),
    value => value === true,
    timeoutMs,
    `folder node ${folderId}`,
  )
}

async function planTapNode(page: SessionPageLike, nodeId: string): Promise<TapNodePlan> {
  return page.evaluate<TapNodePlan>(String.raw`(() => {
    const targetId = ${JSON.stringify(nodeId)}
    const cy = window.cytoscapeInstance
    if (!cy) {
      return { ok: false, error: 'window.cytoscapeInstance unavailable' }
    }

    const node = cy.getElementById(targetId)
    if (!node || typeof node.length !== 'number' || node.length === 0) {
      return { ok: false, error: 'tap target not found: ' + targetId }
    }

    const rendered = typeof node.renderedPosition === 'function' ? node.renderedPosition() : null
    const containerRect = typeof cy.container === 'function'
      ? cy.container()?.getBoundingClientRect() ?? null
      : null

    const safe = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    const x = safe(containerRect?.left) + safe(rendered?.x)
    const y = safe(containerRect?.top) + safe(rendered?.y)
    const withinViewport = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight

    if (withinViewport) {
      return { ok: true, strategy: 'mouse', x, y }
    }

    return { ok: true, strategy: 'emit' }
  })()`)
}

async function emitTapOnNode(page: SessionPageLike, nodeId: string): Promise<void> {
  const result = await page.evaluate<{ ok: boolean; error?: string }>(String.raw`(() => {
    const targetId = ${JSON.stringify(nodeId)}
    const cy = window.cytoscapeInstance
    if (!cy) {
      return { ok: false, error: 'window.cytoscapeInstance unavailable' }
    }
    const node = cy.getElementById(targetId)
    if (!node || typeof node.length !== 'number' || node.length === 0 || typeof node.emit !== 'function') {
      return { ok: false, error: 'tap target not found: ' + targetId }
    }
    node.emit('tap')
    return { ok: true }
  })()`)

  if (!result.ok) {
    throw new Error(result.error ?? `tap fallback failed for ${nodeId}`)
  }
}

async function tapNode(page: PageLike, nodeId: string): Promise<void> {
  const plan = await planTapNode(page, nodeId)
  if (!plan.ok) {
    throw new Error(plan.error)
  }

  if (plan.strategy === 'mouse') {
    await page.mouse.click(plan.x, plan.y)
  } else {
    await emitTapOnNode(page, nodeId)
  }

  await sleep(POST_TAP_WAIT_MS)
}

async function waitForEditor(page: SessionPageLike, editorWindowId: string, timeoutMs: number): Promise<void> {
  await waitFor(
    () => page.evaluate((targetId: string) => {
      return document.getElementById(targetId) !== null
    }, editorWindowId),
    value => value === true,
    timeoutMs,
    `editor window ${editorWindowId}`,
  )
}

async function waitForMaterializedFile(indexPath: string, marker: string, timeoutMs: number): Promise<string> {
  return waitFor(
    async () => {
      try {
        return await fs.readFile(indexPath, 'utf8')
      } catch {
        return ''
      }
    },
    value => value.includes(marker),
    timeoutMs,
    `${indexPath} to contain marker`,
  )
}

export async function folderMaterialize(
  page: PageLike,
  opts: {
    folder?: string
    keepFixture?: boolean
    marker?: string
    timeoutMs?: number
    projectRoot: string
    writeFolder?: string
  },
): Promise<Response<FolderMaterializeResult>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const marker = buildMarker(opts.marker)

  let fixture: ScratchFixture | null = null
  let cleanupPerformed = false
  let cleanupError: string | undefined

  try {
    const writeFolder = path.resolve(opts.writeFolder ?? await readWriteFolder(page))
    const fixtureCreated = opts.folder === undefined
    fixture = fixtureCreated ? await createScratchFixture(writeFolder) : null
    const folderId = opts.folder ?? fixture?.folderId

    if (!folderId) {
      return err('folder-materialize', 'unable to determine folder target')
    }

    const indexPath = path.join(folderId, 'index.md')
    const indexExistedBefore = await pathExists(indexPath)

    await waitForFolderNode(page, folderId, timeoutMs)
    const domProbesBeforeTap = await captureDomProbes(page)

    await tapNode(page, folderId)

    const editorWindowId = buildEditorWindowId(folderId)
    await waitForEditor(page, editorWindowId, timeoutMs)
    const domProbesAfterTap = await captureDomProbes(page)
    const editorSelector = buildEditorSelector(editorWindowId)

    await page.focus(editorSelector)
    await page.keyboard.type(buildCheckpointText(marker))
    await sleep(POST_TYPE_WAIT_MS)

    const domProbesAfterType = await captureDomProbes(page)
    const savedContent = await waitForMaterializedFile(indexPath, marker, timeoutMs)

    if (fixture && !opts.keepFixture) {
      await fs.rm(fixture.folderPath, { recursive: true, force: true })
      cleanupPerformed = true
    }

    return ok('folder-materialize', {
      ...(cleanupError ? { cleanupError } : {}),
      cleanupPerformed,
      domProbesAfterTap,
      domProbesAfterType,
      domProbesBeforeTap,
      editorSelector,
      editorWindowId,
      fixtureCreated,
      folderId,
      indexExistedBefore,
      indexPath,
      marker,
      materializedNow: !indexExistedBefore,
      savedContentLength: savedContent.length,
      savedContentPreview: truncatePreview(savedContent),
      ...(fixture?.seedFilePath ? { seedFilePath: fixture.seedFilePath } : {}),
      projectRoot: path.resolve(opts.projectRoot),
      writeFolder,
      cdpPort: 0,
      mcpPort: 0,
      pid: 0,
    })
  } catch (e) {
    if (fixture && !opts.keepFixture) {
      try {
        await fs.rm(fixture.folderPath, { recursive: true, force: true })
        cleanupPerformed = true
      } catch (cleanupFailure) {
        cleanupError = String(cleanupFailure)
      }
    }

    return err(
      'folder-materialize',
      String(e),
      cleanupPerformed
        ? undefined
        : fixture?.folderPath
          ? `scratch fixture left on disk: ${fixture.folderPath}`
          : undefined,
    )
  }
}

async function folderMaterializeHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if ('ok' in parsed) {
    return parsed
  }

  const pick = await resolveDebugInstance({ port: parsed.port, pid: parsed.pid, vault: parsed.vault })
  if (!pick.ok) {
    return err('folder-materialize', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(pick.instance)
    const [page] = session.pages
    if (!page) {
      return err('folder-materialize', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const interactivePage = page as PageLike
    const writeFolder = await waitForGraphReady(interactivePage, parsed.timeoutMs)
    const selectedVaultPath = parsed.vault ?? (pick.instance.projectRoot || writeFolder)
    const response = await folderMaterialize(interactivePage, {
      ...(parsed.folder ? { folder: parsed.folder } : {}),
      keepFixture: parsed.keepFixture,
      ...(parsed.marker ? { marker: parsed.marker } : {}),
      timeoutMs: parsed.timeoutMs,
      projectRoot: selectedVaultPath,
      writeFolder,
    })

    if (!response.ok) {
      return {
        ...response,
        exitCode: 1,
      }
    }

    return ok('folder-materialize', {
      ...response.result,
      cdpPort: pick.instance.cdpPort,
      mcpPort: pick.instance.mcpPort,
      pid: pick.instance.pid,
      projectRoot: path.resolve(selectedVaultPath || response.result.projectRoot),
    })
  } catch (e) {
    return err(
      'folder-materialize',
      String(e),
      'verify the dev instance is running with MCP + CDP enabled and the graph is loaded',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('folder-materialize', folderMaterializeHandler)
