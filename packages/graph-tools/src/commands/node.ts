import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { registerCommand } from './index'
import { type DebugInstance } from '../debug/discover'
import { resolveDebugInstance } from '../debug/portResolution'
import { ok, err } from '../debug/Response'
import type { Response } from '../debug/Response'
import { createLiveTransport } from '../liveTransport'
import {
  mergeButtons,
  type BBox,
  type ButtonCandidate,
  type ButtonInfo,
  type RegistryButtonCandidate,
} from '../debug/mergeButtons'

interface ElementHandleLike {
  readonly __playwrightHandle?: true
}

interface AccessibilityLike {
  snapshot(options?: { root?: ElementHandleLike | null }): Promise<unknown>
}

interface PageLike {
  $(selector: string): Promise<ElementHandleLike | null>
  evaluate<T, Arg>(fn: (arg: Arg) => T | Promise<T>, arg: Arg): Promise<T>
  accessibility: AccessibilityLike
}

interface ContextLike {
  pages(): PageLike[]
}

interface BrowserLike {
  contexts(): ContextLike[]
  close(): Promise<void>
}

interface ChromiumLike {
  connectOverCDP(endpoint: string): Promise<BrowserLike>
}

type RendererSnapshot = {
  cyRendered: boolean
  bbox: BBox | null
  classes: string[]
  focused: boolean
  rootWindowId: string | null
  registry: RegistryButtonCandidate[]
}

export type NodeInfo = {
  nodeId: string
  filePath: string
  content: string
  cyRendered: boolean
  bbox: BBox | null
  classes: readonly string[]
  focused: boolean
  buttons: readonly ButtonInfo[]
}

function extractChromium(pw: unknown): ChromiumLike {
  const direct = (pw as Record<string, unknown>).chromium
  if (direct) return direct as ChromiumLike
  const def = (pw as Record<string, unknown>).default
  if (def && (def as Record<string, unknown>).chromium) {
    return (def as Record<string, unknown>).chromium as ChromiumLike
  }
  throw new Error('playwright-core loaded but chromium export not found')
}

async function resolveChromium(): Promise<ChromiumLike> {
  try {
    const moduleName = 'playwright-core'
    const pw = await import(moduleName)
    return extractChromium(pw)
  } catch {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const webappNm = path.resolve(dir, '../../../../webapp/node_modules')
    const pwPath = path.resolve(webappNm, 'playwright-core/index.js')
    try {
      const pw = await import(pathToFileURL(pwPath).href)
      return extractChromium(pw)
    } catch (e2) {
      throw new Error(
        `playwright-core not found. Install with: npm install playwright-core\nDetail: ${String(e2)}`,
      )
    }
  }
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

const COLLECT_AX_BUTTONS_SOURCE = String.raw`
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
  let root = null
  try {
    root = document.querySelector(rootSelector)
  } catch {
    root = null
  }
  if (!root || allowed.size === 0) return []

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
    .filter(button => button.label && button.selector && allowed.has(button.normalized))
    .map(({ label, selector, bbox, enabled }) => ({ label, selector, bbox, enabled }))
}
`

const TAKE_RENDERER_SNAPSHOT_SOURCE = String.raw`
(id) => {
  const safeNum = value => (typeof value === 'number' && isFinite(value) ? value : 0)
  const debugWindow = window
  const cy = debugWindow.cytoscapeInstance
  const containerRect = typeof cy?.container === 'function'
    ? cy.container()?.getBoundingClientRect() ?? null
    : null
  const bboxFromRaw = raw => {
    if (!raw) return null
    return {
      x: safeNum(raw.x1 ?? raw.x) + safeNum(containerRect?.left),
      y: safeNum(raw.y1 ?? raw.y) + safeNum(containerRect?.top),
      w: safeNum(raw.w),
      h: safeNum(raw.h),
    }
  }

  const editorWindowId = id + '-editor'
  const floatingWindows = Array.from(document.querySelectorAll('[data-floating-window-id]'))
  const editorWindow = floatingWindows.find(
    el => el.getAttribute('data-floating-window-id') === editorWindowId,
  )
  const active = document.activeElement
  const activeWindow = active?.closest?.('[data-floating-window-id]')

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

  if (!cy) {
    return {
      cyRendered: false,
      bbox: null,
      classes: [],
      focused: activeWindow?.getAttribute('data-floating-window-id') === editorWindowId,
      rootWindowId: editorWindow ? editorWindowId : null,
      registry,
    }
  }

  const node = cy.getElementById(id)
  const present = typeof node.length === 'number' ? node.length > 0 : true
  const hidden = present && typeof node.hidden === 'function' ? node.hidden() : false
  const removed = present && typeof node.removed === 'function' ? node.removed() : false
  const cyRendered = present && !hidden && !removed
  const bbox = present
    ? bboxFromRaw(
        typeof node.renderedBoundingBox === 'function'
          ? node.renderedBoundingBox()
          : typeof node.boundingBox === 'function'
            ? node.boundingBox()
            : null,
      )
    : null
  const classes = present && typeof node.classes === 'function'
    ? [...node.classes()]
    : []

  return {
    cyRendered,
    bbox,
    classes,
    focused: Boolean(
      active && (
        activeWindow?.getAttribute('data-floating-window-id') === editorWindowId ||
        active.id === id ||
        active.getAttribute?.('data-node-id') === id
      )
    ),
    rootWindowId: editorWindow ? editorWindowId : null,
    registry,
  }
}
`

async function collectAxButtons(
  page: PageLike,
  rootSelector: string,
  allowedLabels: readonly string[],
): Promise<readonly ButtonCandidate[]> {
  return page.evaluate(
    ({ source, payload }) => ((0, eval)(source) as (arg: typeof payload) => readonly ButtonCandidate[])(payload),
    { source: COLLECT_AX_BUTTONS_SOURCE, payload: { rootSelector, allowedLabels: [...allowedLabels] } },
  )
}

async function takeRendererSnapshot(page: PageLike, nodeId: string): Promise<RendererSnapshot> {
  return page.evaluate(
    ({ source, nodeId }) => ((0, eval)(source) as (arg: string) => RendererSnapshot)(nodeId),
    { source: TAKE_RENDERER_SNAPSHOT_SOURCE, nodeId },
  )
}

async function inspectNode(
  instance: DebugInstance,
  chromium: ChromiumLike,
  nodeId: string,
  filePath: string,
  content: string,
): Promise<Response<NodeInfo>> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  let browser: BrowserLike | null = null
  try {
    browser = await chromium.connectOverCDP(endpoint)
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      return err('node', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const page = pages[0]
    const renderer = await takeRendererSnapshot(page, nodeId)

    let axButtons: readonly ButtonCandidate[] = []
    if (renderer.rootWindowId) {
      const rootSelector = attributeSelector('data-floating-window-id', renderer.rootWindowId)
      const rootHandle = await page.$(rootSelector)
      if (rootHandle) {
        const snapshot = await page.accessibility.snapshot({ root: rootHandle })
        const axLabels = collectAxLabels(snapshot)
        axButtons = await collectAxButtons(page, rootSelector, axLabels)
      }
    }

    return ok('node', {
      nodeId,
      filePath,
      content,
      cyRendered: renderer.cyRendered,
      bbox: renderer.bbox,
      classes: renderer.classes,
      focused: renderer.focused,
      buttons: mergeButtons(axButtons, renderer.registry, nodeId),
    })
  } catch (e) {
    return err(
      'node',
      `node inspect failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

async function nodeHandler(argv: string[]): Promise<Response<unknown>> {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined
  let nodeId: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '--cdpPort') {
      port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
      port = parseInt(arg.slice(arg.indexOf('=') + 1), 10)
    } else if (arg === '--pid') {
      pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      vault = arg.slice('--vault='.length)
    } else if (arg.startsWith('--')) {
      return err('node', `unknown flag: ${arg}`, 'usage: vt-debug node <id> [--port N|--cdpPort N|--pid N|--vault PATH]', 2)
    } else if (!nodeId) {
      nodeId = arg
    } else {
      return err('node', `unexpected argument: ${arg}`, 'usage: vt-debug node <id> [--port N|--cdpPort N|--pid N|--vault PATH]', 2)
    }
  }

  if (!nodeId) {
    return err('node', 'missing node id', 'usage: vt-debug node <id> [--port N|--cdpPort N|--pid N|--vault PATH]', 2)
  }

  const pick = await resolveDebugInstance({ port, pid, vault })
  if (!pick.ok) {
    return err('node', pick.message, pick.hint, 2)
  }

  const transport = createLiveTransport(pick.instance.mcpPort)
  let state
  try {
    state = await transport.getLiveState()
  } catch (e) {
    return err(
      'node',
      `live state fetch failed: ${String(e)}`,
      `verify MCP server is reachable on port ${pick.instance.mcpPort}`,
      2,
    )
  }

  const graphNode = state.graph.nodes[nodeId]
  if (!graphNode) {
    return err('node', `node not found: ${nodeId}`, 'try: vt-debug cy dump --source data', 1)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('node', String(e), undefined, 3)
  }

  return inspectNode(
    pick.instance,
    chromium,
    nodeId,
    graphNode.absoluteFilePathIsID,
    graphNode.contentWithoutYamlOrLinks,
  )
}

registerCommand('node', nodeHandler)
