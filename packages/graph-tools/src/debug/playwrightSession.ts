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
  close(): Promise<void>
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

export async function resolveChromium(): Promise<ChromiumLike> {
  try {
    const pw = await import('playwright-core')
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

export async function openDebugSession(instance: DebugInstance): Promise<DebugSession> {
  const chromium = await resolveChromium()
  const endpoint = `http://localhost:${instance.cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)
  const pages = browser.contexts().flatMap(ctx => ctx.pages())

  return {
    browser,
    pages,
    close: async () => {
      await browser.close().catch(() => undefined)
    },
  }
}
