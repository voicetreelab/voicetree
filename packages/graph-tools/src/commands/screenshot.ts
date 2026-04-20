import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerCommand } from './index'
import { type DebugInstance } from '../debug/discover'
import { resolveDebugInstance } from '../debug/portResolution'
import { ok, err } from '../debug/Response'
import type { Response } from '../debug/Response'

interface ScreenshotTargetLike {
  screenshot(options?: { path?: string; type?: 'png'; fullPage?: boolean }): Promise<Buffer>
}

interface PageLike extends ScreenshotTargetLike {
  $(selector: string): Promise<ScreenshotTargetLike | null>
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

export type ScreenshotResult = {
  path?: string
  base64?: string
  selector?: string
  fullPage: boolean
  pid: number
  cdpPort: number
}

export type ScreenshotOptions = {
  selector?: string
  base64: boolean
  fullPage: boolean
  outPath?: string
  port?: number
  pid?: number
  vault?: string
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

export function parseArgs(argv: string[]): ScreenshotOptions {
  const options: ScreenshotOptions = {
    base64: false,
    fullPage: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--selector') {
      options.selector = argv[++i]
      options.fullPage = false
    } else if (arg.startsWith('--selector=')) {
      options.selector = arg.slice('--selector='.length)
      options.fullPage = false
    } else if (arg === '--base64') {
      options.base64 = true
    } else if (arg === '--full-page') {
      options.fullPage = true
    } else if (arg === '--out' || arg === '--output' || arg === '-o') {
      options.outPath = argv[++i]
    } else if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length)
    } else if (arg.startsWith('--output=')) {
      options.outPath = arg.slice('--output='.length)
    } else if (arg.startsWith('-o=')) {
      options.outPath = arg.slice('-o='.length)
    } else if (arg === '--port' || arg === '--cdpPort') {
      options.port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
      options.port = parseInt(arg.slice(arg.indexOf('=') + 1), 10)
    } else if (arg === '--pid') {
      options.pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      options.pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      options.vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      options.vault = arg.slice('--vault='.length)
    }
  }

  return options
}

function defaultOutPath(): string {
  return path.join('/tmp', 'vt-debug', 'screenshots', `${Date.now()}.png`)
}

async function captureScreenshot(
  instance: DebugInstance,
  chromium: ChromiumLike,
  options: ScreenshotOptions,
): Promise<Response<ScreenshotResult>> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  let browser: BrowserLike | null = null

  try {
    browser = await chromium.connectOverCDP(endpoint)
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      return err('screenshot', 'CDP connected but no pages found', 'verify app is fully started')
    }

    const page = pages[0]
    const target = options.selector
      ? await page.$(options.selector)
      : page

    if (!target) {
      return err('screenshot', `no element matches selector: ${options.selector}`)
    }

    const shouldWriteFile = !options.base64 || options.outPath !== undefined
    const outPath = shouldWriteFile ? path.resolve(options.outPath ?? defaultOutPath()) : undefined
    if (outPath) {
      await fs.mkdir(path.dirname(outPath), { recursive: true })
    }

    const buffer = await target.screenshot({
      type: 'png',
      ...(options.selector ? {} : { fullPage: options.fullPage }),
      ...(outPath ? { path: outPath } : {}),
    })

    if (options.base64) {
      return ok('screenshot', {
        base64: buffer.toString('base64'),
        ...(outPath ? { path: outPath } : {}),
        ...(options.selector ? { selector: options.selector } : {}),
        fullPage: options.selector ? false : options.fullPage,
        pid: instance.pid,
        cdpPort: instance.cdpPort,
      })
    }

    return ok('screenshot', {
      path: outPath!,
      ...(options.selector ? { selector: options.selector } : {}),
      fullPage: options.selector ? false : options.fullPage,
      pid: instance.pid,
      cdpPort: instance.cdpPort,
    })
  } catch (e) {
    return err(
      'screenshot',
      `CDP screenshot failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

async function screenshotHandler(argv: string[]): Promise<Response<unknown>> {
  const options = parseArgs(argv)

  const pick = await resolveDebugInstance({
    port: options.port,
    pid: options.pid,
    vault: options.vault,
  })

  if (!pick.ok) {
    return err('screenshot', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('screenshot', String(e), undefined, 3)
  }

  return captureScreenshot(pick.instance, chromium, options)
}

registerCommand('screenshot', screenshotHandler)
