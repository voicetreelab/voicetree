import fs from 'node:fs/promises'
import path from 'node:path'
import { registerCommand } from '../index'
import { type DebugInstance } from '@vt/graph-tools/debug/protocol/discover'
import { resolveChromium } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { formatCdpHttpEndpoint, resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { ok, err } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'

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
  disconnect?: () => Promise<void>
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
  project?: string
  forceNew?: boolean
}

const PAGE_WAIT_TIMEOUT_MS = 10_000
const PAGE_WAIT_POLL_MS = 100

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
    } else if (arg === '--project') {
      options.project = argv[++i]
    } else if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length)
    } else if (arg === '--new') {
      options.forceNew = true
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
  const endpoint = formatCdpHttpEndpoint(instance.cdpPort)
  let browser: BrowserLike | null = null

  try {
    browser = await chromium.connectOverCDP(endpoint)
    const page = await waitForFirstPage(browser)
    if (!page) {
      return err('screenshot', 'CDP connected but no pages found', 'verify app is fully started')
    }

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
      const detach = browser.disconnect ?? browser.close.bind(browser)
      await detach().catch(() => undefined)
    }
  }
}

async function waitForFirstPage(browser: BrowserLike): Promise<PageLike | null> {
  const deadline = Date.now() + PAGE_WAIT_TIMEOUT_MS

  while (Date.now() <= deadline) {
    const [page] = browser.contexts().flatMap(ctx => ctx.pages())
    if (page) {
      return page
    }
    await new Promise(resolve => setTimeout(resolve, PAGE_WAIT_POLL_MS))
  }

  return null
}

async function screenshotHandler(argv: string[]): Promise<Response<unknown>> {
  const options = parseArgs(argv)

  const pick = await resolveDebugInstance({
    port: options.port,
    pid: options.pid,
    project: options.project,
    forceNew: options.forceNew,
  })

  if (!pick.ok) {
    return err('screenshot', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = (await resolveChromium()) as unknown as ChromiumLike
  } catch (e) {
    return err('screenshot', String(e), undefined, 3)
  }

  return captureScreenshot(pick.instance, chromium, options)
}

registerCommand('screenshot', screenshotHandler)
