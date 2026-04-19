import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import { err, ok } from '../debug/Response'
import { createLiveTransport } from '../liveTransport'
import { filterLive, pickInstance, readInstancesDir, type DebugInstance } from '../debug/discover'
import type { Response } from '../debug/Response'
import { registerCommand } from './index'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

type ConsoleMsg = {
  level: ConsoleLevel
  args: unknown[]
  atIso: string
}

type ExceptionMsg = {
  message: string
  stack?: string
  atIso: string
}

type ActiveElementSummary = {
  tag: string
  id?: string
  selector?: string
  role?: string
  name?: string
  ax?: unknown
}

export type LogReport = {
  pageTitle: string
  url: string
  loadedRoots: readonly string[]
  debugSurfaceAvailable: boolean
  activeElement: ActiveElementSummary | null
  recentConsoleErrors: readonly ConsoleMsg[]
  uncaughtSinceMs: number
  uncaughtSample: readonly ExceptionMsg[]
  errorCount: number
}

type LogOptions = {
  sinceMs?: number
  port?: number
  pid?: number
  vault?: string
}

type RendererSnapshot = {
  debugSurfaceAvailable: boolean
  consoleMsgs: ConsoleMsg[]
  exceptions: ExceptionMsg[]
  activeElement: {
    tag: string
    id?: string
    selector?: string
  } | null
}

interface ElementHandleLike {}

interface AccessibilityLike {
  snapshot(options?: { root?: ElementHandleLike; interestingOnly?: boolean }): Promise<unknown>
}

interface PageLike {
  title(): Promise<string>
  url(): string
  evaluate<T, Arg>(pageFunction: (arg: Arg) => T | Promise<T>, arg: Arg): Promise<T>
  $(selector: string): Promise<ElementHandleLike | null>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseConsoleMsg(value: unknown): ConsoleMsg | null {
  if (!isRecord(value)) return null
  const level = value.level
  const atIso = value.atIso
  if (
    level !== 'log' &&
    level !== 'info' &&
    level !== 'warn' &&
    level !== 'error' &&
    level !== 'debug'
  ) {
    return null
  }
  if (typeof atIso !== 'string') return null
  return {
    level,
    args: Array.isArray(value.args) ? [...value.args] : [],
    atIso,
  }
}

function parseExceptionMsg(value: unknown): ExceptionMsg | null {
  if (!isRecord(value)) return null
  if (typeof value.message !== 'string' || typeof value.atIso !== 'string') return null
  return {
    message: value.message,
    atIso: value.atIso,
    ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
  }
}

function filterBySinceMs<T extends { atIso: string }>(items: readonly T[], sinceMs?: number): T[] {
  if (sinceMs === undefined) return [...items]
  const cutoff = Date.now() - sinceMs
  return items.filter(item => {
    const ts = Date.parse(item.atIso)
    return Number.isNaN(ts) || ts >= cutoff
  })
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

function parseIntFlag(command: string, flag: string, rawValue: string | undefined): Response<never> | number {
  if (!rawValue || rawValue.startsWith('--')) {
    return err(command, `${flag} requires a value`)
  }

  const parsed = parseInt(rawValue, 10)
  if (!Number.isFinite(parsed)) {
    return err(command, `${flag} must be an integer`)
  }

  return parsed
}

function parseLogOptions(argv: string[]): Response<never> | LogOptions {
  const options: LogOptions = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--since-ms') {
      const parsed = parseIntFlag('log', '--since-ms', argv[++i])
      if (typeof parsed !== 'number') return parsed
      options.sinceMs = parsed
    } else if (arg.startsWith('--since-ms=')) {
      const parsed = parseIntFlag('log', '--since-ms', arg.slice('--since-ms='.length))
      if (typeof parsed !== 'number') return parsed
      options.sinceMs = parsed
    } else if (arg === '--port') {
      const parsed = parseIntFlag('log', '--port', argv[++i])
      if (typeof parsed !== 'number') return parsed
      options.port = parsed
    } else if (arg.startsWith('--port=')) {
      const parsed = parseIntFlag('log', '--port', arg.slice('--port='.length))
      if (typeof parsed !== 'number') return parsed
      options.port = parsed
    } else if (arg === '--pid') {
      const parsed = parseIntFlag('log', '--pid', argv[++i])
      if (typeof parsed !== 'number') return parsed
      options.pid = parsed
    } else if (arg.startsWith('--pid=')) {
      const parsed = parseIntFlag('log', '--pid', arg.slice('--pid='.length))
      if (typeof parsed !== 'number') return parsed
      options.pid = parsed
    } else if (arg === '--vault') {
      options.vault = argv[++i]
      if (!options.vault || options.vault.startsWith('--')) {
        return err('log', '--vault requires a value')
      }
    } else if (arg.startsWith('--vault=')) {
      options.vault = arg.slice('--vault='.length)
      if (!options.vault) return err('log', '--vault requires a value')
    } else {
      return err('log', `unknown arg: ${arg}`)
    }
  }

  return options
}

async function readRendererSnapshot(page: PageLike): Promise<RendererSnapshot> {
  const snapshotSource = `(() => {
    const escapeSelector = value => String(value).replace(/[^a-zA-Z0-9_-]/g, match => '\\\\' + match)
    const debug = globalThis.__vtDebug__
    const consoleMsgs = typeof debug?.console === 'function' ? debug.console(500) : []
    const exceptions = typeof debug?.exceptions === 'function' ? debug.exceptions() : []
    const active = globalThis.document?.activeElement
    let activeElement = null

    if (active && typeof active.tagName === 'string') {
      const tag = String(active.tagName)
      const id = typeof active.id === 'string' ? active.id : ''
      const classes = typeof active.className === 'string'
        ? active.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2)
        : []
      const selector = id
        ? '#' + escapeSelector(id)
        : (tag.toLowerCase() + classes.map(cls => '.' + escapeSelector(cls)).join('')) || tag.toLowerCase()
      activeElement = id ? { tag, id, selector } : { tag, selector }
    }

    return {
      debugSurfaceAvailable: !!debug,
      consoleMsgs: Array.isArray(consoleMsgs) ? consoleMsgs : [],
      exceptions: Array.isArray(exceptions) ? exceptions : [],
      activeElement,
    }
  })()`

  const raw = await page.evaluate(
    (source: string) => (0, eval)(source) as {
      debugSurfaceAvailable: boolean
      consoleMsgs: unknown[]
      exceptions: unknown[]
      activeElement: unknown
    },
    snapshotSource,
  )

  const consoleMsgs = Array.isArray(raw.consoleMsgs)
    ? raw.consoleMsgs.map(parseConsoleMsg).filter((msg): msg is ConsoleMsg => msg !== null)
    : []
  const exceptions = Array.isArray(raw.exceptions)
    ? raw.exceptions.map(parseExceptionMsg).filter((msg): msg is ExceptionMsg => msg !== null)
    : []
  const activeElement = isRecord(raw.activeElement) && typeof raw.activeElement.tag === 'string'
    ? {
        tag: raw.activeElement.tag,
        ...(typeof raw.activeElement.id === 'string' ? { id: raw.activeElement.id } : {}),
        ...(typeof raw.activeElement.selector === 'string'
          ? { selector: raw.activeElement.selector }
          : {}),
      }
    : null

  return {
    debugSurfaceAvailable: raw.debugSurfaceAvailable === true,
    consoleMsgs,
    exceptions,
    activeElement,
  }
}

async function getActiveElementSummary(
  page: PageLike,
  base: RendererSnapshot['activeElement'],
): Promise<ActiveElementSummary | null> {
  if (!base) return null
  const handle = await page.$(':focus')
  if (!handle) return base

  try {
    const ax = await page.accessibility.snapshot({ root: handle, interestingOnly: false })
    if (!isRecord(ax)) return base
    return {
      ...base,
      ...(typeof ax.role === 'string' ? { role: ax.role } : {}),
      ...(typeof ax.name === 'string' ? { name: ax.name } : {}),
      ax,
    }
  } catch {
    return base
  }
}

async function connectPage(
  instance: DebugInstance,
  chromium: ChromiumLike,
): Promise<{ browser: BrowserLike; page: PageLike }> {
  const browser = await chromium.connectOverCDP(`http://localhost:${instance.cdpPort}`)
  const pages = browser.contexts().flatMap(ctx => ctx.pages())
  if (pages.length === 0) {
    await browser.close().catch(() => undefined)
    throw new Error('CDP connected but no pages found')
  }
  return { browser, page: pages[0] }
}

async function buildLogReport(
  instance: DebugInstance,
  page: PageLike,
  sinceMs?: number,
): Promise<LogReport> {
  const [pageTitle, liveState, renderer] = await Promise.all([
    page.title(),
    createLiveTransport(instance.mcpPort).getLiveState(),
    readRendererSnapshot(page),
  ])
  const activeElement = await getActiveElementSummary(page, renderer.activeElement)
  const recentConsoleErrors = filterBySinceMs(renderer.consoleMsgs, sinceMs)
    .filter(msg => msg.level === 'error')
    .slice(-20)
  const uncaught = filterBySinceMs(renderer.exceptions, sinceMs)

  return {
    pageTitle,
    url: page.url(),
    loadedRoots: [...liveState.roots.loaded],
    debugSurfaceAvailable: renderer.debugSurfaceAvailable,
    activeElement,
    recentConsoleErrors,
    uncaughtSinceMs: uncaught.length,
    uncaughtSample: uncaught.slice(-10),
    errorCount: uncaught.length,
  }
}

async function logHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseLogOptions(argv)
  if ('ok' in parsed) return parsed

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, {
    port: parsed.port,
    pid: parsed.pid,
    vault: parsed.vault,
  })

  if ('message' in pick) {
    return err('log', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('log', String(e), undefined, 3)
  }

  let browser: BrowserLike | null = null
  try {
    const connection = await connectPage(pick.instance, chromium)
    browser = connection.browser
    return ok('log', await buildLogReport(pick.instance, connection.page, parsed.sinceMs))
  } catch (e) {
    return err(
      'log',
      `CDP connect failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

registerCommand('log', logHandler)
