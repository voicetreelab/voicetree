import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { registerCommand } from './index'
import { readInstancesDir, filterLive, pickInstance, type DebugInstance } from '../debug/discover'
import { ok, err } from '../debug/Response'
import type { Response } from '../debug/Response'

// Duck types — avoids hard playwright-core compile-time dependency
interface PageLike {
  title(): Promise<string>
  url(): string
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

export type AttachResult = {
  pageTitle: string
  url: string
  tabs: number
  pid: number
  cdpPort: number
}

// Shell: resolve playwright-core from standard path or webapp workspace fallback.
// playwright-core/index.js is CJS so dynamic ESM import wraps it as { default: module }.
function extractChromium(pw: unknown): ChromiumLike {
  // Try direct named export (hoisted ESM build), then CJS default wrapper
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
    // Fallback: webapp workspace node_modules (monorepo layout)
    const dir = path.dirname(fileURLToPath(import.meta.url))
    // src/commands/ → src/ → graph-tools/ → packages/ → root → webapp/node_modules
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

// Shell: connect to Voicetree via CDP and query page info
async function attachToInstance(
  instance: DebugInstance,
  chromium: ChromiumLike,
): Promise<Response<AttachResult>> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  let browser: BrowserLike | null = null
  try {
    browser = await chromium.connectOverCDP(endpoint)
    // CDP connection wraps everything in a default context
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      return err('attach', 'CDP connected but no pages found', 'verify app is fully started')
    }
    const page = pages[0]
    const pageTitle = await page.title()
    const url = page.url()
    return ok('attach', { pageTitle, url, tabs: pages.length, pid: instance.pid, cdpPort: instance.cdpPort })
  } catch (e) {
    return err(
      'attach',
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

async function attachHandler(argv: string[]): Promise<Response<unknown>> {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
    } else if (arg === '--pid') {
      pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      vault = arg.slice('--vault='.length)
    }
  }

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, { port, pid, vault })

  if (!pick.ok) {
    return err('attach', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('attach', String(e), undefined, 3)
  }

  return attachToInstance(pick.instance, chromium)
}

registerCommand('attach', attachHandler)
