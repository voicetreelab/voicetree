import fs from 'node:fs/promises'
import path from 'node:path'
import { hydrateCommand, serializeState, type Delta, type State } from '@vt/graph-state'
import { type DebugInstance } from '../debug/discover'
import { computeDrift, type DriftData, type FsContentById } from '../debug/drift'
import { normalizeChord } from '../debug/normalizeChord'
import { openDebugSession, type PageLike as SessionPageLike } from '../debug/playwrightSession'
import { resolveDebugInstance } from '../debug/portResolution'
import { projectStateToCyDump } from '../debug/projectedCyDump'
import { err, ok } from '../debug/Response'
import type { Response } from '../debug/Response'
import { parseCyDump, type CyDump } from '../debug/cyStateShape'
import {
  STEP_SPEC_SELECTOR_NOTE,
  validateStepSpec,
  type StepSpec,
} from '../debug/stepShape'
import { createLiveTransport } from '../liveTransport'
import { registerCommand } from './index'

const DEFAULT_RUN_DIR = '/tmp/vt-debug/run'
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 5000
const DEFAULT_CLICK_TIMEOUT_MS = 2000

interface PageLike extends SessionPageLike {
  click(selector: string, options?: { timeout?: number }): Promise<void>
  goto(url: string): Promise<unknown>
  mouse: {
    click(x: number, y: number): Promise<void>
  }
  screenshot(options: { path: string; type?: 'png'; fullPage?: boolean }): Promise<Buffer>
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<unknown>
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

type TapNodePlan =
  | { ok: true; strategy: 'mouse'; x: number; y: number }
  | { ok: true; strategy: 'emit' }
  | { ok: false; error: string }

type RunOptions = {
  specSource: string
  screenshotEach: boolean
  consoleEach: boolean
  driftEach: boolean
  stateEach: boolean
  stopOnError: boolean
  outDir: string
  port?: number
  pid?: number
  vault?: string
}

type LoadedSteps = {
  steps: StepSpec[]
  source: string
}

export type RunStepOutput = {
  step: StepSpec
  ok: boolean
  error?: string
  observationErrors?: string[]
  screenshot?: string
  console?: string
  drift?: string
  state?: string
}

export type RunResult = {
  source: string
  bundle: {
    dir: string
    stepCount: number
    outputs: RunStepOutput[]
  }
}

type SerializedStateSnapshot = ReturnType<typeof serializeState>

export type StateCaptureOverlay = {
  collapseSet: string[]
  selection: string[]
  rootsLoaded: string[]
  layout: {
    zoom?: number
    pan?: { x: number; y: number }
  }
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
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

export function createStateCaptureOverlay(state: State): StateCaptureOverlay {
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

export function applyDeltaToStateCaptureOverlay(
  overlay: StateCaptureOverlay,
  delta: Delta | null | undefined,
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

export function buildCapturedSerializedState(
  state: State,
  overlay: StateCaptureOverlay | null | undefined,
  rendered: CyDump | null,
): SerializedStateSnapshot {
  const serialized = serializeState(state)

  const layout = {
    ...serialized.layout,
    ...(overlay?.layout.zoom !== undefined ? { zoom: overlay.layout.zoom } : {}),
    ...(overlay?.layout.pan !== undefined ? { pan: overlay.layout.pan } : {}),
    ...(rendered ? { zoom: rendered.viewport.zoom, pan: rendered.viewport.pan } : {}),
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

function usage(message?: string): Response<never> {
  return err(
    'run',
    message ?? 'usage: vt-debug run <spec-file|inline-json> [flags]',
    [
      '--screenshot-each',
      '--console-each',
      '--drift-each',
      '--state-each',
      '--stop-on-error=false',
      '--out <dir>',
      '[--port <n> | --cdpPort <n> | --pid <n> | --vault <path>]',
      `selectors: ${STEP_SPEC_SELECTOR_NOTE}`,
    ].join(' '),
  )
}

function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

function parseBoolean(flag: string, value: string | undefined): boolean {
  const raw = readFlagValue(flag, value)
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${flag} must be true or false`)
}

export function parseRunArgs(argv: string[]): RunOptions | Response<never> {
  let specSource: string | undefined
  let screenshotEach = false
  let consoleEach = false
  let driftEach = false
  let stateEach = false
  let stopOnError = true
  let outDir = path.join(DEFAULT_RUN_DIR, String(Date.now()))
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--screenshot-each') {
        screenshotEach = true
      } else if (arg === '--console-each') {
        consoleEach = true
      } else if (arg === '--drift-each') {
        driftEach = true
      } else if (arg === '--state-each') {
        stateEach = true
      } else if (arg === '--stop-on-error') {
        stopOnError = parseBoolean('--stop-on-error', argv[++i])
      } else if (arg.startsWith('--stop-on-error=')) {
        stopOnError = parseBoolean('--stop-on-error', arg.slice('--stop-on-error='.length))
      } else if (arg === '--out') {
        outDir = path.resolve(readFlagValue('--out', argv[++i]))
      } else if (arg.startsWith('--out=')) {
        outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
      } else if (arg === '--port' || arg === '--cdpPort') {
        port = parseNumber('--port', argv[++i])
      } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        port = parseNumber('--port', arg.slice(arg.indexOf('=') + 1))
      } else if (arg === '--pid') {
        pid = parseNumber('--pid', argv[++i])
      } else if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
      } else if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[++i])
      } else if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
      } else if (arg.startsWith('--')) {
        return usage(`unknown argument: ${arg}`)
      } else if (specSource === undefined) {
        specSource = arg
      } else {
        return usage(`unexpected positional argument: ${arg}`)
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (!specSource) {
    return usage('run requires a spec file path or inline JSON array')
  }

  return {
    specSource,
    screenshotEach,
    consoleEach,
    driftEach,
    stateEach,
    stopOnError,
    outDir,
    port,
    pid,
    vault,
  }
}

function isErrorResponse<T>(value: T | Response<never>): value is Response<never> {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function parseStepSpecsDocument(raw: string): LoadedSteps | Response<never> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return usage(`spec JSON parse failed: ${String(e)}`)
  }

  const rawSteps = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.steps)
      ? parsed.steps
      : null

  if (!rawSteps) {
    return usage('spec must be a JSON array or an object with a steps array')
  }

  const steps: StepSpec[] = []
  for (let i = 0; i < rawSteps.length; i += 1) {
    const result = validateStepSpec(rawSteps[i])
    if (!result.ok) {
      return usage(`invalid step at index ${i}: ${result.error}`)
    }
    steps.push(result.step)
  }

  return { source: 'inline-json', steps }
}

async function loadSteps(specSource: string): Promise<LoadedSteps | Response<never>> {
  const looksLikeInlineJson = specSource.trim().startsWith('[') || specSource.trim().startsWith('{')
  if (looksLikeInlineJson) {
    const parsed = parseStepSpecsDocument(specSource)
    if (isErrorResponse(parsed)) return parsed
    return parsed
  }

  const filePath = path.resolve(specSource)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = parseStepSpecsDocument(raw)
    if (isErrorResponse(parsed)) return parsed
    return { ...parsed, source: filePath }
  } catch (e) {
    return usage(`unable to read spec file: ${String(e)}`)
  }
}

async function resolveTarget(options: RunOptions) {
  const pick = await resolveDebugInstance({ port: options.port, pid: options.pid, vault: options.vault })
  if (!pick.ok) {
    return { ok: false as const, response: err('run', pick.message, pick.hint, 2) }
  }
  return { ok: true as const, instance: pick.instance }
}

async function focusTarget(page: SessionPageLike, selector: string): Promise<void> {
  const result = await page.evaluate<{ ok: boolean; error: string }>(String.raw`(() => {
    const rootSelector = ${JSON.stringify(selector)}
    const root = document.querySelector(rootSelector)
    if (!(root instanceof HTMLElement)) {
      return { ok: false, error: 'selector not found: ' + rootSelector }
    }

    const focusableSelector =
      '.cm-content, textarea, input, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'
    const target =
      root.matches(focusableSelector)
        ? root
        : root.querySelector(focusableSelector)

    if (!(target instanceof HTMLElement)) {
      return { ok: false, error: 'selector "' + rootSelector + '" did not resolve to a focusable element' }
    }

    target.focus()
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      return { ok: false, error: 'selector "' + rootSelector + '" did not take focus' }
    }

    return {
      ok: target === active || target.contains(active),
      error: 'selector "' + rootSelector + '" did not take focus',
    }
  })()`)

  if (!result.ok) {
    throw new Error(result.error)
  }
}

async function executeStep(
  page: PageLike,
  step: StepSpec,
  instance: DebugInstance,
): Promise<Delta | null> {
  if ('dispatch' in step) {
    const transport = createLiveTransport(instance.mcpPort)
    return transport.dispatchLiveCommand(hydrateCommand(step.dispatch))
  }

  if ('click' in step) {
    await page.click(step.click, { timeout: DEFAULT_CLICK_TIMEOUT_MS })
    return null
  }

  if ('tapNode' in step) {
    await executeTapNodeStep(page, step.tapNode)
    return null
  }

  if ('type' in step) {
    if (step.selector) {
      await focusTarget(page, step.selector)
    }
    await page.keyboard.type(step.type)
    return null
  }

  if ('press' in step) {
    if (step.selector) {
      await focusTarget(page, step.selector)
    }
    await page.keyboard.press(normalizeChord(step.press))
    return null
  }

  if ('wait' in step) {
    await new Promise(resolve => setTimeout(resolve, step.wait))
    return null
  }

  if ('waitFor' in step) {
    await page.waitForSelector(step.waitFor, {
      timeout: step.timeoutMs ?? DEFAULT_WAIT_FOR_TIMEOUT_MS,
    })
    return null
  }

  await page.goto(step.navigate)
  return null
}

async function fetchRendered(page: SessionPageLike): Promise<CyDump> {
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

async function tryFetchRendered(page: SessionPageLike): Promise<CyDump | null> {
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

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
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
      return { ok: false, error: 'tapNode target not found: ' + targetId }
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
      return { ok: false, error: 'tapNode target not found: ' + targetId }
    }
    node.emit('tap')
    return { ok: true }
  })()`)

  if (!result.ok) {
    throw new Error(result.error ?? `tapNode fallback failed for ${nodeId}`)
  }
}

async function executeTapNodeStep(page: PageLike, nodeId: string): Promise<void> {
  const plan = await planTapNode(page, nodeId)
  if (!plan.ok) {
    throw new Error(plan.error)
  }

  if (plan.strategy === 'mouse') {
    await page.mouse.click(plan.x, plan.y)
  } else {
    await emitTapOnNode(page, nodeId)
  }

  await sleep(400)
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

async function captureConsoleTail(page: SessionPageLike): Promise<unknown> {
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

async function captureDomProbes(page: SessionPageLike): Promise<DomProbes> {
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
  instance: DebugInstance,
  page: SessionPageLike,
  overlay?: StateCaptureOverlay | null,
): Promise<unknown> {
  const transport = createLiveTransport(instance.mcpPort)
  const [state, domProbes, rendered] = await Promise.all([
    transport.getLiveState(),
    captureDomProbes(page),
    tryFetchRendered(page),
  ])

  return {
    ...buildCapturedSerializedState(state, overlay, rendered),
    domProbes,
  }
}

async function captureDrift(instance: DebugInstance, page: SessionPageLike): Promise<unknown> {
  const transport = createLiveTransport(instance.mcpPort)
  const [state, rendered] = await Promise.all([
    transport.getLiveState(),
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

function stepBaseName(index: number): string {
  return `step-${String(index + 1).padStart(2, '0')}`
}

async function runSteps(
  instance: DebugInstance,
  page: PageLike,
  steps: StepSpec[],
  options: RunOptions,
): Promise<RunStepOutput[]> {
  const outputs: RunStepOutput[] = []
  let captureOverlay: StateCaptureOverlay | null = null

  if (options.stateEach) {
    try {
      const transport = createLiveTransport(instance.mcpPort)
      captureOverlay = createStateCaptureOverlay(await transport.getLiveState())
    } catch {
      captureOverlay = null
    }
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    const output: RunStepOutput = { step, ok: true }
    const observationErrors: string[] = []
    let stepDelta: Delta | null = null

    try {
      stepDelta = await executeStep(page, step, instance)
      if (captureOverlay) {
        captureOverlay = applyDeltaToStateCaptureOverlay(captureOverlay, stepDelta)
      }
    } catch (e) {
      output.ok = false
      output.error = String(e)
    }

    const baseName = path.join(options.outDir, stepBaseName(i))

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
      if (result.error) {
        observationErrors.push(`console: ${result.error}`)
      }
    }

    if (options.driftEach) {
      const result = await captureJsonObservation(
        `${baseName}.drift.json`,
        () => captureDrift(instance, page),
      )
      output.drift = result.path
      if (result.error) {
        observationErrors.push(`drift: ${result.error}`)
      }
    }

    if (options.stateEach) {
      const result = await captureJsonObservation(
        `${baseName}.state.json`,
        () => captureSerializedState(instance, page, captureOverlay),
      )
      output.state = result.path
      if (result.error) {
        observationErrors.push(`state: ${result.error}`)
      }
    }

    if (observationErrors.length > 0) {
      output.observationErrors = observationErrors
    }

    outputs.push(output)

    if (!output.ok && options.stopOnError) {
      break
    }
  }

  return outputs
}

async function runHandler(argv: string[]): Promise<Response<RunResult>> {
  const options = parseRunArgs(argv)
  if (isErrorResponse(options)) return options

  const loaded = await loadSteps(options.specSource)
  if (isErrorResponse(loaded)) return loaded

  await fs.mkdir(options.outDir, { recursive: true })

  if (loaded.steps.length === 0) {
    return ok('run', {
      source: loaded.source,
      bundle: {
        dir: options.outDir,
        stepCount: 0,
        outputs: [],
      },
    })
  }

  const target = await resolveTarget(options)
  if (!target.ok) return target.response

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(target.instance)
    const page = session.pages[0] as PageLike | undefined
    if (!page) {
      return err('run', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const outputs = await runSteps(target.instance, page, loaded.steps, options)
    return ok('run', {
      source: loaded.source,
      bundle: {
        dir: options.outDir,
        stepCount: loaded.steps.length,
        outputs,
      },
    })
  } catch (e) {
    return err(
      'run',
      String(e),
      'verify the dev instance is running with MCP + CDP enabled',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('run', runHandler)
