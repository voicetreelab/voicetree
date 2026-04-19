import fs from 'node:fs/promises'
import path from 'node:path'

import { filterLive, pickInstance, readInstancesDir, type DebugInstance } from '../debug/discover'
import { mergeButtons, type ButtonCandidate, type ButtonInfo, type RegistryButtonCandidate } from '../debug/mergeButtons'
import { openDebugSession } from '../debug/playwrightSession'
import { err, ok } from '../debug/Response'
import type { Response } from '../debug/Response'
import { registerCommand } from './index'

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

const POST_CLICK_WAIT_MS = 150

const COLLECT_BUTTONS_SOURCE = String.raw`
({ rootSelector, allowedLabels }) => {
  const normalize = label => label.replace(/\s+/g, ' ').trim().toLowerCase()
  const safeNum = value => (typeof value === 'number' && isFinite(value) ? value : 0)
  const boxFromRect = rect => ({
    x: safeNum(rect.left),
    y: safeNum(rect.top),
    w: safeNum(rect.width),
    h: safeNum(rect.height),
  })
  const labelOf = el => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const title = el.getAttribute('title')
    if (title && title.trim()) return title.trim()
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  const isDisabled = el => {
    if (el.getAttribute('aria-disabled') === 'true') return true
    return 'disabled' in el ? Boolean(el.disabled) : false
  }
  const selectorOf = el => {
    if (el.id) return '#' + CSS.escape(el.id)
    const parts = []
    let current = el
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase()
      const floatingWindowId = current.getAttribute('data-floating-window-id')
      if (floatingWindowId) {
        part += '[data-floating-window-id="' + CSS.escape(floatingWindowId) + '"]'
        parts.unshift(part)
        break
      }
      if (current instanceof HTMLElement && current.classList.length > 0) {
        part += '.' + [...current.classList].slice(0, 3).map(name => CSS.escape(name)).join('.')
      }
      const parent = current.parentElement
      if (parent) {
        const currentTag = current.tagName
        const siblings = [...parent.children].filter(sibling => sibling.tagName === currentTag)
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
        }
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(' > ')
  }

  const allowed = new Set(allowedLabels)
  const allowAll = allowed.size === 0
  let root = null
  try {
    root = document.querySelector(rootSelector)
  } catch {
    root = null
  }
  if (!root) return []

  return Array.from(root.querySelectorAll('button, a, [role="button"], [role="link"], [role="menuitem"]'))
    .map(el => {
      const label = labelOf(el)
      return {
        label,
        normalized: normalize(label),
        selector: selectorOf(el),
        bbox: boxFromRect(el.getBoundingClientRect()),
        enabled: !isDisabled(el),
      }
    })
    .filter(button => button.label && button.selector && (allowAll || allowed.has(button.normalized)))
    .map(({ label, selector, bbox, enabled }) => ({ label, selector, bbox, enabled }))
}
`

const TAKE_RENDERER_SNAPSHOT_SOURCE = String.raw`
(id) => {
  const safeNum = value => (typeof value === 'number' && isFinite(value) ? value : 0)
  const debugWindow = window
  const editorWindowId = id + '-editor'
  const floatingWindows = Array.from(document.querySelectorAll('[data-floating-window-id]'))
  const editorWindow = floatingWindows.find(
    el => el.getAttribute('data-floating-window-id') === editorWindowId,
  )

  const registryRaw = typeof debugWindow.__vtDebug__?.buttons === 'function'
    ? debugWindow.__vtDebug__.buttons()
    : []
  const registry = Array.isArray(registryRaw)
    ? registryRaw.map(entry => {
      const rec = entry ?? {}
      const selector = typeof rec.selector === 'string' ? rec.selector : ''
      let element = null
      if (selector) {
        try {
          element = document.querySelector(selector)
        } catch {
          element = null
        }
      }
      const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null
      const disabled = element && 'disabled' in element ? Boolean(element.disabled) : false
      return {
        nodeId: String(rec.nodeId ?? ''),
        label: String(rec.label ?? ''),
        selector,
        bbox: rect
          ? {
              x: safeNum(rect.left),
              y: safeNum(rect.top),
              w: safeNum(rect.width),
              h: safeNum(rect.height),
            }
          : { x: 0, y: 0, w: 0, h: 0 },
        enabled: element ? !disabled && element.getAttribute('aria-disabled') !== 'true' : true,
      }
    })
    : []

  return {
    rootWindowId: editorWindow ? editorWindowId : null,
    registry,
  }
}
`

const BEGIN_CAPTURE_SOURCE = String.raw`
({ selector, markKey }) => {
  const target = document.querySelector(selector)
  if (!(target instanceof HTMLElement)) {
    return { ok: false, error: 'selector not found: ' + selector }
  }

  const globalStore = window
  const previous = globalStore[markKey]
  if (previous && typeof previous.cleanup === 'function') {
    try {
      previous.cleanup()
    } catch {}
  }

  const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'input', 'change', 'focusin', 'focusout']
  const events = []
  const handler = event => {
    const origin = event.target
    if (origin === target || (origin instanceof Node && target.contains(origin))) {
      events.push(event.type)
    }
  }

  for (const type of eventTypes) {
    document.addEventListener(type, handler)
  }

  globalStore[markKey] = {
    beforeMs: Date.now(),
    events,
    cleanup: () => {
      for (const type of eventTypes) {
        document.removeEventListener(type, handler)
      }
    },
  }

  return { ok: true }
}
`

const END_CAPTURE_SOURCE = String.raw`
(markKey) => {
  const globalStore = window
  const store = globalStore[markKey]
  const beforeMs = typeof store?.beforeMs === 'number' ? store.beforeMs : 0

  const serialize = (value, seen = new Set()) => {
    if (value === null) return null
    const type = typeof value
    if (type === 'string' || type === 'number' || type === 'boolean') return value
    if (type === 'undefined' || type === 'bigint' || type === 'symbol' || type === 'function') {
      return String(value)
    }
    if (type !== 'object') return String(value)
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
      return value.map(item => serialize(item, seen))
    }
    if (value && value.nodeType === 1 && typeof value.tagName === 'string') {
      const id = typeof value.id === 'string' && value.id ? '#' + value.id : ''
      return '<' + value.tagName.toLowerCase() + id + '>'
    }

    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      const name = value?.constructor?.name
      return name ? '[' + name + ']' : String(value)
    }

    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = serialize(entry, seen)
    }
    return out
  }

  const consoleRaw = typeof globalStore.__vtDebug__?.console === 'function'
    ? globalStore.__vtDebug__.console()
    : []
  const consoleAfter = Array.isArray(consoleRaw)
    ? consoleRaw
        .filter(entry => {
          const atIso = typeof entry?.atIso === 'string' ? entry.atIso : ''
          const atMs = Date.parse(atIso)
          return Number.isNaN(atMs) || atMs >= beforeMs
        })
        .map(entry => ({
          level: entry?.level === 'log' || entry?.level === 'info' || entry?.level === 'warn' || entry?.level === 'error' || entry?.level === 'debug'
            ? entry.level
            : 'log',
          args: Array.isArray(entry?.args) ? entry.args.map(arg => serialize(arg)) : [],
          atIso: typeof entry?.atIso === 'string' ? entry.atIso : new Date().toISOString(),
        }))
    : []

  const dispatchedEvents = Array.isArray(store?.events) ? [...store.events] : []

  if (store && typeof store.cleanup === 'function') {
    try {
      store.cleanup()
    } catch {}
  }
  try {
    delete globalStore[markKey]
  } catch {}

  return { dispatchedEvents, consoleAfter }
}
`

function usage(message?: string): Response<never> {
  return err(
    'node-click',
    message ?? 'usage: vt-debug node click <id> <label|index>',
    'usage: vt-debug node click <id> <label|index> [--port N|--pid N|--vault PATH]',
    2,
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

function defaultScreenshotPath(): string {
  return path.join('/tmp', 'vt-debug', 'node-click', `${Date.now()}.png`)
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
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--port') {
        port = parseNumber('--port', argv[++i])
      } else if (arg.startsWith('--port=')) {
        port = parseNumber('--port', arg.slice('--port='.length))
      } else if (arg === '--pid') {
        pid = parseNumber('--pid', argv[++i])
      } else if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
      } else if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[++i])
      } else if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
      } else if (arg.startsWith('--')) {
        return usage(`unknown flag: ${arg}`)
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
    port,
    pid,
    vault,
  }
}

async function collectButtons(
  page: PageLike,
  nodeId: string,
): Promise<readonly ButtonInfo[]> {
  const renderer = await page.evaluate(
    ({ source, nodeId }) => ((0, eval)(source) as (arg: string) => RendererSnapshot)(nodeId),
    { source: TAKE_RENDERER_SNAPSHOT_SOURCE, nodeId },
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
        { source: COLLECT_BUTTONS_SOURCE, payload: { rootSelector, allowedLabels: [...axLabels] } },
      )
    }
  }

  return mergeButtons(axButtons, renderer.registry, nodeId)
}

async function beginCapture(page: PageLike, selector: string): Promise<CaptureBeginResult> {
  return page.evaluate(
    ({ source, payload }) => ((0, eval)(source) as (arg: typeof payload) => CaptureBeginResult)(payload),
    { source: BEGIN_CAPTURE_SOURCE, payload: { selector, markKey: '__vtNodeClickCapture' } },
  )
}

async function endCapture(page: PageLike): Promise<CaptureEndResult> {
  return page.evaluate(
    ({ source, markKey }) => ((0, eval)(source) as (arg: string) => CaptureEndResult)(markKey),
    { source: END_CAPTURE_SOURCE, markKey: '__vtNodeClickCapture' },
  )
}

async function waitAfterClick(page: PageLike): Promise<void> {
  await page.evaluate(
    ms => new Promise<void>(resolve => {
      setTimeout(resolve, ms)
    }),
    POST_CLICK_WAIT_MS,
  )
}

function listAvailableButtons(buttons: readonly ButtonInfo[]): string {
  return buttons
    .map((button, index) => `${index}:${button.label}`)
    .join(', ')
}

async function clickButton(
  instance: DebugInstance,
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
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
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

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, {
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
