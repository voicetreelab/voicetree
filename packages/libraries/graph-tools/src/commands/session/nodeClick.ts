import fs from 'node:fs/promises'

import { mergeButtons, type ButtonCandidate, type ButtonInfo, type RegistryButtonCandidate } from '@vt/graph-tools/debug/input/mergeButtons'
import { openDebugSession } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { err, ok } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'
import { consumeDebugTargetFlag, type DebugTargetArgs } from '../core/argv'
import { registerCommand } from '../index'
import { getBrowserSources } from './nodeClick/browserSources.js'

const browserSources = getBrowserSources()

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ConsoleMsg = {
  level: ConsoleLevel
  args: unknown[]
  atIso: string
}

export type ButtonMatch =
  | { kind: 'index'; index: number }
  | { kind: 'label'; label: string }

export type NodeClickResult = {
  nodeId: string
  button: ButtonInfo
  matchedBy: ButtonMatch
  dispatchedEvents: readonly string[]
  consoleAfter: readonly ConsoleMsg[]
  screenshotPath: string
  pid: number
  cdpPort: number
}

type NodeClickOptions = {
  nodeId: string
  buttonRef: string
  port?: number
  pid?: number
  vault?: string
}

type RendererSnapshot = {
  rootWindowId: string | null
  registry: RegistryButtonCandidate[]
}

type SelectionResult<T> =
  | { ok: true; button: T; index: number; matchedBy: ButtonMatch }
  | { ok: false; error: string }

type CaptureBeginResult =
  | { ok: true }
  | { ok: false; error: string }

type CaptureEndResult = {
  dispatchedEvents: string[]
  consoleAfter: ConsoleMsg[]
}

type ClickInstance = {
  pid: number
  cdpPort: number
}

interface ElementHandleLike {
  readonly __playwrightHandle?: true
  click(): Promise<void>
}

interface AccessibilityLike {
  snapshot(options?: { root?: ElementHandleLike | null }): Promise<unknown>
}

interface PageLike {
  $(selector: string): Promise<ElementHandleLike | null>
  evaluate<T, Arg>(fn: (arg: Arg) => T | Promise<T>, arg: Arg): Promise<T>
  screenshot(options?: { path?: string; type?: 'png'; fullPage?: boolean }): Promise<Buffer>
  accessibility: AccessibilityLike
}

function usage(message?: string): Response<never> {
  return err(
    'node-click',
    message ?? 'usage: vt-debug node click <id> <label|index>',
    'usage: vt-debug node click <id> <label|index> [--port N|--cdpPort N|--pid N|--vault PATH]',
    2,
  )
}

function defaultScreenshotPath(): string {
  return `/tmp/vt-debug/node-click/${Date.now()}.png`
}

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase()
}

function collectAxLabels(raw: unknown): readonly string[] {
  const labels = new Set<string>()

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    const role = typeof rec.role === 'string' ? rec.role : ''
    const name = typeof rec.name === 'string' ? rec.name : ''
    if ((role === 'button' || role === 'link' || role === 'menuitem') && name.trim()) {
      labels.add(normalizeLabel(name))
    }
    const children = rec.children
    if (Array.isArray(children)) {
      for (const child of children) visit(child)
    }
  }

  visit(raw)
  return [...labels]
}

function attributeSelector(attr: string, value: string): string {
  return `[${attr}=${JSON.stringify(value)}]`
}

export function parseButtonMatch(raw: string): ButtonMatch {
  const trimmed = raw.trim()
  if (/^-?\d+$/.test(trimmed)) {
    return { kind: 'index', index: Number.parseInt(trimmed, 10) }
  }
  return { kind: 'label', label: raw }
}

export function selectButton<T extends { label: string }>(
  buttons: readonly T[],
  rawRef: string,
): SelectionResult<T> {
  if (buttons.length === 0) {
    return { ok: false, error: 'no buttons available for selection' }
  }

  const matchedBy = parseButtonMatch(rawRef)
  if (matchedBy.kind === 'index') {
    if (matchedBy.index < 0 || matchedBy.index >= buttons.length) {
      return {
        ok: false,
        error: `button index out of range: ${matchedBy.index} (have ${buttons.length} buttons, zero-based)`,
      }
    }

    return {
      ok: true,
      button: buttons[matchedBy.index],
      index: matchedBy.index,
      matchedBy,
    }
  }

  const normalized = normalizeLabel(matchedBy.label)
  if (!normalized) {
    return { ok: false, error: 'button label cannot be empty' }
  }

  const matches = buttons
    .map((button, index) => ({ button, index }))
    .filter(({ button }) => normalizeLabel(button.label) === normalized)

  if (matches.length === 0) {
    return { ok: false, error: `button label not found: ${matchedBy.label}` }
  }

  if (matches.length > 1) {
    return { ok: false, error: `button label is ambiguous: ${matchedBy.label}` }
  }

  return {
    ok: true,
    button: matches[0].button,
    index: matches[0].index,
    matchedBy,
  }
}

function parseArgs(argv: string[]): NodeClickOptions | Response<never> {
  const positional: string[] = []
  const target: DebugTargetArgs = {}

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg.startsWith('--')) {
        const debugTargetFlag = consumeDebugTargetFlag(argv, i, target)
        if (!debugTargetFlag.matched) {
          return usage(`unknown flag: ${arg}`)
        }
        i = debugTargetFlag.nextIndex
      } else {
        positional.push(arg)
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (positional.length === 0) return usage('missing node id')
  if (positional.length === 1) return usage('missing button label or index')
  if (positional.length > 2) return usage(`unexpected argument: ${positional[2]}`)

  return {
    nodeId: positional[0],
    buttonRef: positional[1],
    port: target.port,
    pid: target.pid,
    vault: target.vault,
  }
}

async function collectButtons(
  page: PageLike,
  nodeId: string,
): Promise<readonly ButtonInfo[]> {
  const renderer = await page.evaluate(
    ({ source, nodeId }) => ((0, eval)(source) as (arg: string) => RendererSnapshot)(nodeId),
    { source: browserSources.TAKE_RENDERER_SNAPSHOT_SOURCE, nodeId },
  )

  let axButtons: readonly ButtonCandidate[] = []
  if (renderer.rootWindowId) {
    const rootSelector = attributeSelector('data-floating-window-id', renderer.rootWindowId)
    const rootHandle = await page.$(rootSelector)
    if (rootHandle) {
      const snapshot = await page.accessibility.snapshot({ root: rootHandle })
      const axLabels = collectAxLabels(snapshot)
      axButtons = await page.evaluate(
        ({ source, payload }) => ((0, eval)(source) as (arg: typeof payload) => readonly ButtonCandidate[])(payload),
        { source: browserSources.COLLECT_BUTTONS_SOURCE, payload: { rootSelector, allowedLabels: [...axLabels] } },
      )
    }
  }

  return mergeButtons(axButtons, renderer.registry, nodeId)
}

async function beginCapture(page: PageLike, selector: string): Promise<CaptureBeginResult> {
  return page.evaluate(
    ({ source, payload }) => ((0, eval)(source) as (arg: typeof payload) => CaptureBeginResult)(payload),
    { source: browserSources.BEGIN_CAPTURE_SOURCE, payload: { selector, markKey: '__vtNodeClickCapture' } },
  )
}

async function endCapture(page: PageLike): Promise<CaptureEndResult> {
  return page.evaluate(
    ({ source, markKey }) => ((0, eval)(source) as (arg: string) => CaptureEndResult)(markKey),
    { source: browserSources.END_CAPTURE_SOURCE, markKey: '__vtNodeClickCapture' },
  )
}

async function waitAfterClick(page: PageLike): Promise<void> {
  await page.evaluate(
    ms => new Promise<void>(resolve => {
      setTimeout(resolve, ms)
    }),
    browserSources.POST_CLICK_WAIT_MS,
  )
}

function listAvailableButtons(buttons: readonly ButtonInfo[]): string {
  return buttons
    .map((button, index) => `${index}:${button.label}`)
    .join(', ')
}

async function clickButton(
  instance: ClickInstance,
  page: PageLike,
  options: NodeClickOptions,
): Promise<Response<NodeClickResult>> {
  const buttons = await collectButtons(page, options.nodeId)
  const selection = selectButton(buttons, options.buttonRef)
  if (!selection.ok) {
    return err(
      'node-click',
      selection.error,
      buttons.length > 0
        ? `available buttons: ${listAvailableButtons(buttons)}`
        : `try: vt-debug node ${JSON.stringify(options.nodeId)}`,
      1,
    )
  }

  if (!selection.button.enabled) {
    return err('node-click', `button is disabled: ${selection.button.label}`, undefined, 1)
  }

  const target = await page.$(selection.button.selector)
  if (!target) {
    return err(
      'node-click',
      `button selector not found: ${selection.button.selector}`,
      `try: vt-debug node ${JSON.stringify(options.nodeId)} to refresh available buttons`,
      1,
    )
  }

  const captureStart = await beginCapture(page, selection.button.selector)
  if (!captureStart.ok) {
    return err('node-click', captureStart.error, undefined, 1)
  }

  await target.click()
  await waitAfterClick(page)

  const screenshotPath = defaultScreenshotPath()
  await fs.mkdir('/tmp/vt-debug/node-click', { recursive: true })
  await page.screenshot({ path: screenshotPath, type: 'png', fullPage: true })

  const captureEnd = await endCapture(page)

  return ok('node-click', {
    nodeId: options.nodeId,
    button: selection.button,
    matchedBy: selection.matchedBy,
    dispatchedEvents: captureEnd.dispatchedEvents,
    consoleAfter: captureEnd.consoleAfter,
    screenshotPath,
    pid: instance.pid,
    cdpPort: instance.cdpPort,
  })
}

async function nodeClickHandler(argv: string[]): Promise<Response<unknown>> {
  const options = parseArgs(argv)
  if ('ok' in options) return options

  const pick = await resolveDebugInstance({
    port: options.port,
    pid: options.pid,
    vault: options.vault,
  })
  if (!pick.ok) {
    return err('node-click', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(pick.instance)
  } catch (e) {
    return err('node-click', String(e), undefined, 3)
  }

  try {
    const page = session.pages[0] as unknown as PageLike | undefined
    if (!page) {
      return err('node-click', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    return await clickButton(pick.instance, page, options)
  } catch (e) {
    return err(
      'node-click',
      `node click failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      1,
    )
  } finally {
    if (session) {
      await session.close().catch(() => undefined)
    }
  }
}

registerCommand('node-click', nodeClickHandler)
