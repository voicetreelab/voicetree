import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { registerCommand } from './index'
import { type DebugInstance } from '../debug/discover'
import { resolveDebugInstance } from '../debug/portResolution'
import { ok, err } from '../debug/Response'
import type { Response } from '../debug/Response'

interface ElementHandleLike {}

interface AccessibilityLike {
  snapshot(options?: { root?: ElementHandleLike; interestingOnly?: boolean }): Promise<unknown>
}

interface PageLike {
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

type PageAxArgs = {
  port?: number
  pid?: number
  vault?: string
  selector?: string
}

function parseArgs(argv: string[]): PageAxArgs {
  const parsed: PageAxArgs = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '--cdpPort') {
      parsed.port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
      parsed.port = parseInt(arg.slice(arg.indexOf('=') + 1), 10)
    } else if (arg === '--pid') {
      parsed.pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      parsed.pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      parsed.vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      parsed.vault = arg.slice('--vault='.length)
    } else if (arg === '--selector') {
      parsed.selector = argv[++i]
    } else if (arg.startsWith('--selector=')) {
      parsed.selector = arg.slice('--selector='.length)
    }
  }

  return parsed
}

async function snapshotPageAx(
  instance: DebugInstance,
  chromium: ChromiumLike,
  selector?: string,
): Promise<Response<unknown>> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  let browser: BrowserLike | null = null

  try {
    browser = await chromium.connectOverCDP(endpoint)
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      return err('page-ax', 'CDP connected but no pages found', 'verify app is fully started')
    }

    const page = pages[0]
    let root: ElementHandleLike | undefined
    if (selector) {
      root = await page.$(selector) ?? undefined
      if (!root) {
        return err('page-ax', `selector not found: ${selector}`, 'pass a CSS selector that exists in the renderer')
      }
    }

    const snapshot = await page.accessibility.snapshot(
      root ? { root, interestingOnly: false } : { interestingOnly: false },
    )
    if (!snapshot) {
      return err(
        'page-ax',
        'accessibility snapshot returned an empty tree',
        selector
          ? `selector "${selector}" did not resolve to an accessible subtree`
          : 'try --selector on a specific app root',
      )
    }

    return ok('page-ax', snapshot)
  } catch (e) {
    return err(
      'page-ax',
      `CDP accessibility snapshot failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

async function pageAxHandler(argv: string[]): Promise<Response<unknown>> {
  const { port, pid, vault, selector } = parseArgs(argv)

  const pick = await resolveDebugInstance({ port, pid, vault })

  if (!pick.ok) {
    return err('page-ax', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('page-ax', String(e), undefined, 3)
  }

  return snapshotPageAx(pick.instance, chromium, selector)
}

registerCommand('page-ax', pageAxHandler)
