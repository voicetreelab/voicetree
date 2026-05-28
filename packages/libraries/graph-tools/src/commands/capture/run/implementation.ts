import fs from 'node:fs/promises'
import path from 'node:path'
import { hydrateCommand, type Delta } from '@vt/graph-state'
import { normalizeChord } from '@vt/graph-tools/debug/input/normalizeChord'
import { pressChord } from '@vt/graph-tools/debug/input/pressChord'
import { err, ok, type Response } from '@vt/graph-tools/debug/protocol/Response'
import { openDebugSession, type PageLike as SessionPageLike } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import {
  STEP_SPEC_SELECTOR_NOTE,
  validateStepSpec,
  type StepSpec,
} from '@vt/graph-tools/debug/flow/stepShape'
import { createLiveTransport } from '@vt/graph-tools/live/liveTransport'
import {
  consumeDebugTargetFlag,
  parseBooleanFlag,
  readFlagValue,
  type DebugTargetArgs,
} from '@vt/graph-tools/commands/core/argv'
import { runObservations } from './observations'

type ResolvedDebugTarget = Awaited<ReturnType<typeof resolveDebugInstance>>
type DebugInstance = Extract<ResolvedDebugTarget, { ok: true }>['instance']
type PageLike = SessionPageLike & {
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
type RunStepOutput = {
  step: StepSpec
  ok: boolean
  error?: string
  observationErrors?: string[]
  screenshot?: string
  console?: string
  drift?: string
  state?: string
}
type RunResult = {
  source: string
  bundle: {
    dir: string
    stepCount: number
    outputs: RunStepOutput[]
  }
}
type StateCaptureOverlay = ReturnType<typeof runObservations.createStateCaptureOverlay>

const DEFAULT_RUN_DIR = '/tmp/vt-debug/run'
const DEFAULT_WAIT_FOR_TIMEOUT_MS = 5000
const DEFAULT_CLICK_TIMEOUT_MS = 2000

function isErrorResponse<T>(value: T | Response<never>): value is Response<never> {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
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

function parseRunArgs(argv: string[]): RunOptions | Response<never> {
  let specSource: string | undefined
  let screenshotEach = false
  let consoleEach = false
  let driftEach = false
  let stateEach = false
  let stopOnError = true
  let outDir = path.join(DEFAULT_RUN_DIR, String(Date.now()))
  const target: DebugTargetArgs = {}

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--screenshot-each') screenshotEach = true
      else if (arg === '--console-each') consoleEach = true
      else if (arg === '--drift-each') driftEach = true
      else if (arg === '--state-each') stateEach = true
      else if (arg === '--stop-on-error') stopOnError = parseBooleanFlag('--stop-on-error', argv[++i])
      else if (arg.startsWith('--stop-on-error=')) {
        stopOnError = parseBooleanFlag('--stop-on-error', arg.slice('--stop-on-error='.length))
      } else if (arg === '--out') outDir = path.resolve(readFlagValue('--out', argv[++i]))
      else if (arg.startsWith('--out=')) outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
      else if (arg.startsWith('--')) {
        const debugTargetFlag = consumeDebugTargetFlag(argv, i, target)
        if (!debugTargetFlag.matched) return usage(`unknown argument: ${arg}`)
        i = debugTargetFlag.nextIndex
      } else if (specSource === undefined) specSource = arg
      else return usage(`unexpected positional argument: ${arg}`)
    }
  } catch (e) {
    return usage(String(e))
  }

  if (!specSource) return usage('run requires a spec file path or inline JSON array')

  return {
    specSource,
    screenshotEach,
    consoleEach,
    driftEach,
    stateEach,
    stopOnError,
    outDir,
    port: target.port,
    pid: target.pid,
    vault: target.vault,
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function parseStepSpecsDocument(raw: string): LoadedSteps | Response<never> {
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

  if (!rawSteps) return usage('spec must be a JSON array or an object with a steps array')

  const steps: StepSpec[] = []
  for (let i = 0; i < rawSteps.length; i += 1) {
    const result = validateStepSpec(rawSteps[i])
    if (!result.ok) return usage(`invalid step at index ${i}: ${result.error}`)
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

  if (!result.ok) throw new Error(result.error)
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function planTapNode(
  page: SessionPageLike,
  nodeId: string,
): Promise<
  | { ok: true; strategy: 'mouse'; x: number; y: number }
  | { ok: true; strategy: 'emit' }
  | { ok: false; error: string }
> {
  return page.evaluate(String.raw`(() => {
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

  if (!result.ok) throw new Error(result.error ?? `tapNode fallback failed for ${nodeId}`)
}

async function executeTapNodeStep(page: PageLike, nodeId: string): Promise<void> {
  const plan = await planTapNode(page, nodeId)
  if (!plan.ok) throw new Error(plan.error)

  if (plan.strategy === 'mouse') await page.mouse.click(plan.x, plan.y)
  else await emitTapOnNode(page, nodeId)

  await sleep(400)
}

async function executeStep(
  page: PageLike,
  step: StepSpec,
  instance: Pick<DebugInstance, 'projectRoot'>,
): Promise<Delta | null> {
  if ('dispatch' in step) {
    const transport = createLiveTransport(instance.projectRoot)
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
    if (step.selector) await focusTarget(page, step.selector)
    await page.keyboard.type(step.type)
    return null
  }

  if ('press' in step) {
    if (step.selector) await focusTarget(page, step.selector)
    await pressChord(page, normalizeChord(step.press))
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

async function resolveTarget(options: RunOptions) {
  const pick = await resolveDebugInstance({ port: options.port, pid: options.pid, vault: options.vault })
  if (!pick.ok) {
    return { ok: false as const, response: err('run', pick.message, pick.hint, 2) }
  }
  return { ok: true as const, instance: pick.instance }
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
      const transport = createLiveTransport(instance.projectRoot)
      captureOverlay = runObservations.createStateCaptureOverlay(await transport.getLiveState())
    } catch {
      captureOverlay = null
    }
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    const output: RunStepOutput = { step, ok: true }
    let stepDelta: Delta | null = null

    try {
      stepDelta = await executeStep(page, step, instance)
      if (captureOverlay) {
        captureOverlay = runObservations.applyDeltaToStateCaptureOverlay(captureOverlay, stepDelta)
      }
    } catch (e) {
      output.ok = false
      output.error = String(e)
    }

    Object.assign(output, await runObservations.captureStepObservations({
      page,
      baseName: path.join(options.outDir, stepBaseName(i)),
      captureOverlay,
      getLiveState: () => createLiveTransport(instance.projectRoot).getLiveState(),
      options,
    }))

    outputs.push(output)

    if (!output.ok && options.stopOnError) break
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
    if (session) await session.close()
  }
}

export const runImplementation = {
  applyDeltaToStateCaptureOverlay: runObservations.applyDeltaToStateCaptureOverlay,
  buildCapturedSerializedState: runObservations.buildCapturedSerializedState,
  createStateCaptureOverlay: runObservations.createStateCaptureOverlay,
  runHandler,
}
