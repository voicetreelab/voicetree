import fs from 'node:fs/promises'
import { serializeState, type State } from '@vt/graph-state'
import { sortStrings } from '@vt/graph-state/project-helpers'
import { computeDrift, type DriftData, type FsContentById } from '@vt/graph-tools/debug/state/drift'
import { projectStateToCyDump } from '@vt/graph-tools/debug/state/projectedCyDump'
import { parseCyDump, type CyDump } from '@vt/graph-tools/debug/state/cyStateShape'

type EvaluationPage = {
  evaluate<T>(script: string | (() => unknown)): Promise<T>
}

type PageLike = EvaluationPage & {
  screenshot(options: { path: string; type?: 'png'; fullPage?: boolean }): Promise<Buffer>
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
  rootClientHeightPx: number
  sidebarWrapperVisible: boolean
}

type StateCaptureOverlay = {
  collapseSet: string[]
  selection: string[]
  rootsLoaded: string[]
  layout: {
    zoom?: number
    pan?: { x: number; y: number }
  }
}

type CaptureStepObservationsParams = {
  page: PageLike
  baseName: string
  captureOverlay: StateCaptureOverlay | null
  getLiveState: () => Promise<State>
  options: {
    consoleEach: boolean
    driftEach: boolean
    screenshotEach: boolean
    stateEach: boolean
  }
}

function removeValues(values: readonly string[], removed: readonly string[] | undefined): string[] {
  if (!removed || removed.length === 0) return [...values]
  const removedSet = new Set(removed)
  return values.filter(value => !removedSet.has(value))
}

function appendUnique(values: readonly string[], added: readonly string[] | undefined): string[] {
  if (!added || added.length === 0) return [...values]

  const next = [...values]
  const seen = new Set(next)
  for (const value of added) {
    if (seen.has(value)) continue
    next.push(value)
    seen.add(value)
  }
  return next
}

function updateOrderedValues(
  values: readonly string[],
  removed: readonly string[] | undefined,
  added: readonly string[] | undefined,
): string[] {
  return appendUnique(removeValues(values, removed), added)
}

function createStateCaptureOverlay(state: State): StateCaptureOverlay {
  return {
    collapseSet: sortStrings([...state.collapseSet]),
    selection: [...state.selection],
    rootsLoaded: sortStrings([...state.roots.loaded]),
    layout: {
      ...(state.layout.zoom !== undefined ? { zoom: state.layout.zoom } : {}),
      ...(state.layout.pan !== undefined ? { pan: state.layout.pan } : {}),
    },
  }
}

function applyDeltaToStateCaptureOverlay(
  overlay: StateCaptureOverlay,
  delta: {
    collapseRemoved?: readonly string[]
    collapseAdded?: readonly string[]
    selectionRemoved?: readonly string[]
    selectionAdded?: readonly string[]
    rootsUnloaded?: readonly string[]
    rootsLoaded?: readonly string[]
    layoutChanged?: { zoom?: number; pan?: { x: number; y: number } }
  } | null | undefined,
): StateCaptureOverlay {
  if (!delta) return overlay

  const next: StateCaptureOverlay = {
    collapseSet: updateOrderedValues(
      overlay.collapseSet,
      delta.collapseRemoved,
      delta.collapseAdded,
    ),
    selection: updateOrderedValues(
      overlay.selection,
      delta.selectionRemoved,
      delta.selectionAdded,
    ),
    rootsLoaded: updateOrderedValues(
      overlay.rootsLoaded,
      delta.rootsUnloaded,
      delta.rootsLoaded,
    ),
    layout: {
      ...overlay.layout,
      ...(delta.layoutChanged?.zoom !== undefined ? { zoom: delta.layoutChanged.zoom } : {}),
      ...(delta.layoutChanged?.pan !== undefined ? { pan: delta.layoutChanged.pan } : {}),
    },
  }

  return {
    ...next,
    collapseSet: sortStrings(next.collapseSet),
    rootsLoaded: sortStrings(next.rootsLoaded),
  }
}

function buildCapturedSerializedState(
  state: State,
  overlay: StateCaptureOverlay | null | undefined,
  rendered: CyDump | null,
): ReturnType<typeof serializeState> {
  const serialized = serializeState(state)
  const overlayZoom = overlay?.layout.zoom
  const overlayPan = overlay?.layout.pan

  const layout = {
    ...serialized.layout,
    ...(overlayZoom !== undefined ? { zoom: overlayZoom } : {}),
    ...(overlayPan !== undefined ? { pan: overlayPan } : {}),
    ...(serialized.layout.zoom === undefined && overlayZoom === undefined && rendered
      ? { zoom: rendered.viewport.zoom }
      : {}),
    ...(serialized.layout.pan === undefined && overlayPan === undefined && rendered
      ? { pan: rendered.viewport.pan }
      : {}),
  }

  if (!overlay) {
    return {
      ...serialized,
      layout,
    }
  }

  return {
    ...serialized,
    roots: {
      ...serialized.roots,
      loaded: [...overlay.rootsLoaded],
    },
    collapseSet: [...overlay.collapseSet],
    selection: [...overlay.selection],
    layout,
  }
}

async function fetchRendered(page: EvaluationPage): Promise<CyDump> {
  const raw = await page.evaluate(() => {
    const helper = (window as unknown as Record<string, unknown>)['__vtDebug__']
    if (!helper) return null
    const cy = (helper as Record<string, unknown>)['cy']
    return typeof cy === 'function' ? (cy as () => unknown)() : null
  })

  if (raw === null) {
    throw new Error('window.__vtDebug__.cy() unavailable')
  }

  return parseCyDump(raw)
}

async function tryFetchRendered(page: EvaluationPage): Promise<CyDump | null> {
  try {
    return await fetchRendered(page)
  } catch {
    return null
  }
}

async function snapshotFsContent(state: State): Promise<FsContentById> {
  const entries = await Promise.all(
    Object.keys(state.graph.nodes).map(async (nodeId) => {
      try {
        const content = await fs.readFile(nodeId, 'utf8')
        return [nodeId, content] as const
      } catch {
        return [nodeId, null] as const
      }
    }),
  )
  return Object.fromEntries(entries)
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function captureScreenshot(page: PageLike, filePath: string): Promise<string> {
  await page.screenshot({ path: filePath, type: 'png', fullPage: true })
  return filePath
}

async function captureJsonObservation(
  filePath: string,
  producer: () => Promise<unknown>,
): Promise<{ path: string; error?: string }> {
  try {
    const data = await producer()
    await writeJsonFile(filePath, data)
    return { path: filePath }
  } catch (e) {
    const error = String(e)
    await writeJsonFile(filePath, { ok: false, error })
    return { path: filePath, error }
  }
}

async function captureConsoleTail(page: EvaluationPage): Promise<unknown> {
  const consoleTail = await page.evaluate(() => {
    const helper = (window as unknown as Record<string, unknown>)['__vtDebug__']
    if (!helper) return null
    const readConsole = (helper as Record<string, unknown>)['console']
    return typeof readConsole === 'function' ? (readConsole as (...args: unknown[]) => unknown)(500) : null
  })

  if (consoleTail === null) {
    throw new Error('window.__vtDebug__.console() unavailable')
  }

  return consoleTail
}

async function captureDomProbes(page: EvaluationPage): Promise<DomProbes> {
  return page.evaluate<DomProbes>(String.raw`(() => {
    const safe = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
    const intersectsViewport = rect =>
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    const isVisible = element => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        safe(rect.width) > 0 &&
        safe(rect.height) > 0
      )
    }

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

    const selectedNodeHasEditor =
      selectedNodeIds.length > 0 &&
      selectedNodeIds.every(nodeId => rectById.get('window-' + nodeId + '-editor')?.intersectsViewport === true)

    const root = document.getElementById('root')
    const sidebarWrapper = document.querySelector('.sidebar-wrapper')
    const cyNodeCount =
      typeof window.cytoscapeInstance?.nodes === 'function'
        ? window.cytoscapeInstance.nodes().length
        : 0

    return {
      cyNodeCount,
      floatingEditors: floatingEditorElements.map(element => element.id),
      floatingEditorRects,
      selectedNodeHasEditor,
      rootClientHeightPx: root instanceof HTMLElement ? root.clientHeight : 0,
      sidebarWrapperVisible: isVisible(sidebarWrapper),
    }
  })()`)
}

async function captureSerializedState(
  page: EvaluationPage,
  getLiveState: () => Promise<State>,
  overlay?: StateCaptureOverlay | null,
): Promise<unknown> {
  const [state, domProbes, rendered] = await Promise.all([
    getLiveState(),
    captureDomProbes(page),
    tryFetchRendered(page),
  ])

  return {
    ...buildCapturedSerializedState(state, overlay, rendered),
    domProbes,
  }
}

async function captureDrift(
  getLiveState: () => Promise<State>,
  page: EvaluationPage,
): Promise<unknown> {
  const [state, rendered] = await Promise.all([
    getLiveState(),
    fetchRendered(page),
  ])
  const projected = projectStateToCyDump(state)
  const fsContentById = await snapshotFsContent(state)
  return computeDrift(
    {
      ...state,
      fsContentById,
    } satisfies DriftData,
    projected,
    rendered,
  )
}

async function captureStepObservations({
  page,
  baseName,
  captureOverlay,
  getLiveState,
  options,
}: CaptureStepObservationsParams): Promise<{
  observationErrors?: string[]
  screenshot?: string
  console?: string
  drift?: string
  state?: string
}> {
  const output: {
    observationErrors?: string[]
    screenshot?: string
    console?: string
    drift?: string
    state?: string
  } = {}
  const observationErrors: string[] = []

  if (options.screenshotEach) {
    try {
      output.screenshot = await captureScreenshot(page, `${baseName}.png`)
    } catch (e) {
      observationErrors.push(`screenshot: ${String(e)}`)
    }
  }

  if (options.consoleEach) {
    const result = await captureJsonObservation(
      `${baseName}.console.json`,
      () => captureConsoleTail(page),
    )
    output.console = result.path
    if (result.error) observationErrors.push(`console: ${result.error}`)
  }

  if (options.driftEach) {
    const result = await captureJsonObservation(
      `${baseName}.drift.json`,
      () => captureDrift(getLiveState, page),
    )
    output.drift = result.path
    if (result.error) observationErrors.push(`drift: ${result.error}`)
  }

  if (options.stateEach) {
    const result = await captureJsonObservation(
      `${baseName}.state.json`,
      () => captureSerializedState(page, getLiveState, captureOverlay),
    )
    output.state = result.path
    if (result.error) observationErrors.push(`state: ${result.error}`)
  }

  if (observationErrors.length > 0) output.observationErrors = observationErrors

  return output
}

export const runObservations = {
  applyDeltaToStateCaptureOverlay,
  buildCapturedSerializedState,
  captureStepObservations,
  createStateCaptureOverlay,
}
