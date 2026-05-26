import fs from 'node:fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { DebugInstance } from './discover'

export interface KeyboardLike {
  type(text: string, options?: { delay?: number }): Promise<void>
  press(key: string): Promise<void>
}

export interface PageLike {
  evaluate<R>(pageFunction: string): Promise<R>
  title(): Promise<string>
  url(): string
  focus(selector: string): Promise<void>
  evaluate<R>(pageFunction: () => R): Promise<R>
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R, arg: Arg): Promise<R>
  keyboard: KeyboardLike
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

export interface DebugSession {
  browser: BrowserLike
  pages: PageLike[]
  focusTarget(page: PageLike, selector: string): Promise<void>
  close(): Promise<void>
}

export interface OpenDebugSessionOptions {
  waitForPagesMs?: number
  pollMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function extractChromium(pw: unknown): ChromiumLike {
  const direct = (pw as Record<string, unknown>).chromium
  if (direct) return direct as ChromiumLike
  const def = (pw as Record<string, unknown>).default
  if (def && (def as Record<string, unknown>).chromium) {
    return (def as Record<string, unknown>).chromium as ChromiumLike
  }
  throw new Error('playwright-core loaded but chromium export not found')
}

function findWebappNodeModules(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'webapp', 'node_modules')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('webapp/node_modules not found walking up from ' + startDir)
}

export async function resolveChromium(): Promise<ChromiumLike> {
  try {
    const pw = await import('playwright-core')
    return extractChromium(pw)
  } catch {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const webappNm = findWebappNodeModules(dir)
    const pwPath = path.join(webappNm, 'playwright-core', 'index.js')
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

export async function openDebugSession(
  instance: DebugInstance,
  opts: OpenDebugSessionOptions = {},
): Promise<DebugSession> {
  const chromium = await resolveChromium()
  const endpoint = `http://localhost:${instance.cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)
  const waitMs = opts.waitForPagesMs ?? 5000
  const pollMs = opts.pollMs ?? 250
  const deadline = Date.now() + waitMs

  let pages = browser.contexts().flatMap(ctx => ctx.pages())
  while (pages.length === 0 && Date.now() < deadline) {
    await sleep(pollMs)
    pages = browser.contexts().flatMap(ctx => ctx.pages())
  }

  return {
    browser,
    pages,
    focusTarget,
    close: async () => {
      await browser.close().catch(() => undefined)
    },
  }
}

async function focusTarget(page: PageLike, selector: string): Promise<void> {
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
