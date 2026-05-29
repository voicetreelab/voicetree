import { registerCommand } from '../index'
import { type DebugInstance } from '@vt/graph-tools/debug/protocol/discover'
import { resolveChromium } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { ok, err } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'

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

type PageAxArgs = {
  port?: number
  pid?: number
  project?: string
  forceNew?: boolean
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
    } else if (arg === '--project') {
      parsed.project = argv[++i]
    } else if (arg.startsWith('--project=')) {
      parsed.project = arg.slice('--project='.length)
    } else if (arg === '--selector') {
      parsed.selector = argv[++i]
    } else if (arg.startsWith('--selector=')) {
      parsed.selector = arg.slice('--selector='.length)
    } else if (arg === '--new') {
      parsed.forceNew = true
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
  const { port, pid, project, forceNew, selector } = parseArgs(argv)

  const pick = await resolveDebugInstance({ port, pid, project, forceNew })

  if (!pick.ok) {
    return err('page-ax', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = (await resolveChromium()) as unknown as ChromiumLike
  } catch (e) {
    return err('page-ax', String(e), undefined, 3)
  }

  return snapshotPageAx(pick.instance, chromium, selector)
}

registerCommand('page-ax', pageAxHandler)
