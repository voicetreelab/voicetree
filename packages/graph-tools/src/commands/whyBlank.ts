import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { project, type State } from '@vt/graph-state'
import { registerCommand } from './index'
import { readInstancesDir, filterLive, pickInstance, type DebugInstance } from '../debug/discover'
import { ok, err } from '../debug/Response'
import {
  diagnose,
  type BlankConsoleMessage,
  type BlankException,
  type BlankMessages,
  type BlankState,
  type RootDomInfo,
  type ScreenshotSample,
} from '../debug/whyBlank'
import { createLiveTransport } from '../liveTransport'
import type { Response } from '../debug/Response'

type SeedScenario =
  | 'throw-in-init'
  | 'zero-height-root'
  | 'empty-graph-no-roots'
  | 'css-hidden-root'
  | 'projected-empty'

const VALID_SEEDS: ReadonlySet<SeedScenario> = new Set([
  'throw-in-init',
  'zero-height-root',
  'empty-graph-no-roots',
  'css-hidden-root',
  'projected-empty',
])

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>
  screenshot(options?: { type?: 'png'; fullPage?: boolean }): Promise<Buffer>
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

type CommandError = {
  ok: false
  command: string
  error: string
  hint?: string
  exitCode?: number
}

type ParsedArgs =
  | { ok: true; port?: number; pid?: number; vault?: string; seed?: SeedScenario }
  | { ok: false; message: string; hint?: string }

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

function parseIntFlag(raw: string, flagName: string): number {
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} expects an integer, got "${raw}"`)
  }
  return parsed
}

function parseArgs(argv: string[]): ParsedArgs {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined
  let seed: SeedScenario | undefined

  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]
      if (arg === '--port') {
        port = parseIntFlag(argv[++i] ?? '', '--port')
      } else if (arg.startsWith('--port=')) {
        port = parseIntFlag(arg.slice('--port='.length), '--port')
      } else if (arg === '--pid') {
        pid = parseIntFlag(argv[++i] ?? '', '--pid')
      } else if (arg.startsWith('--pid=')) {
        pid = parseIntFlag(arg.slice('--pid='.length), '--pid')
      } else if (arg === '--vault') {
        vault = argv[++i]
      } else if (arg.startsWith('--vault=')) {
        vault = arg.slice('--vault='.length)
      } else if (arg === '--seed') {
        const value = argv[++i] ?? ''
        if (!VALID_SEEDS.has(value as SeedScenario)) {
          return {
            ok: false,
            message: `unknown --seed scenario "${value}"`,
            hint: `valid seeds: ${[...VALID_SEEDS].join(', ')}`,
          }
        }
        seed = value as SeedScenario
      } else if (arg.startsWith('--seed=')) {
        const value = arg.slice('--seed='.length)
        if (!VALID_SEEDS.has(value as SeedScenario)) {
          return {
            ok: false,
            message: `unknown --seed scenario "${value}"`,
            hint: `valid seeds: ${[...VALID_SEEDS].join(', ')}`,
          }
        }
        seed = value as SeedScenario
      } else {
        return {
          ok: false,
          message: `unknown argument "${arg}"`,
          hint: 'supported flags: --port, --pid, --vault, --seed',
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      message: String(e),
      hint: 'supported flags: --port, --pid, --vault, --seed',
    }
  }

  return { ok: true, port, pid, vault, seed }
}

function summarizeState(state: State): BlankState {
  return {
    loadedRoots: [...state.roots.loaded].sort((left, right) => left.localeCompare(right)),
    graphNodeCount: Object.keys(state.graph.nodes).length,
    projectedNodeCount: project(state).nodes.length,
  }
}

async function fetchShot(page: PageLike): Promise<ScreenshotSample> {
  const png = await page.screenshot({ type: 'png' })
  return { bytes: png.byteLength }
}

async function fetchMessages(page: PageLike): Promise<BlankMessages> {
  const raw = await page.evaluate(() => {
    const vtWindow = window as unknown as {
      __vtDebug__?: {
        console?: () => unknown[]
        exceptions?: () => unknown[]
      }
    }
    const vtDebug = vtWindow.__vtDebug__

    return {
      console: Array.isArray(vtDebug?.console?.()) ? vtDebug?.console?.() ?? [] : [],
      exceptions: Array.isArray(vtDebug?.exceptions?.()) ? vtDebug?.exceptions?.() ?? [] : [],
    }
  })

  function stringify(value: unknown): string {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return {
    console: (Array.isArray(raw.console) ? raw.console : []).map(entry => {
      const msg = entry as Record<string, unknown>
      return {
        level: typeof msg.level === 'string' ? msg.level : 'log',
        text: Array.isArray(msg.args) ? msg.args.map(stringify).join(' ') : stringify(msg),
        atIso: typeof msg.atIso === 'string' ? msg.atIso : undefined,
      }
    }) as BlankConsoleMessage[],
    exceptions: (Array.isArray(raw.exceptions) ? raw.exceptions : []).map(entry => {
      const msg = entry as Record<string, unknown>
      return {
        message: typeof msg.message === 'string' ? msg.message : stringify(entry),
        stack: typeof msg.stack === 'string' ? msg.stack : undefined,
        atIso: typeof msg.atIso === 'string' ? msg.atIso : undefined,
      }
    }) as BlankException[],
  }
}

async function fetchRootDomInfo(page: PageLike): Promise<RootDomInfo> {
  return page.evaluate(() => {
    const root = document.getElementById('root')
    if (!root) {
      return {
        exists: false,
        clientWidth: 0,
        clientHeight: 0,
        rectWidth: 0,
        rectHeight: 0,
        childElementCount: 0,
        display: 'missing',
        visibility: 'missing',
      }
    }

    const rect = root.getBoundingClientRect()
    const style = window.getComputedStyle(root)
    return {
      exists: true,
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
      childElementCount: root.childElementCount,
      display: style.display,
      visibility: style.visibility,
    }
  })
}

function applySeed(
  seed: SeedScenario | undefined,
  sample: {
    shot: ScreenshotSample
    msgs: BlankMessages
    state: BlankState
    root: RootDomInfo
  },
): {
  shot: ScreenshotSample
  msgs: BlankMessages
  state: BlankState
  root: RootDomInfo
} {
  if (!seed) return sample

  switch (seed) {
    case 'throw-in-init':
      return {
        ...sample,
        msgs: {
          ...sample.msgs,
          exceptions: [
            ...sample.msgs.exceptions,
            {
              message: 'Seeded startup exception: renderer crashed during init',
              atIso: new Date().toISOString(),
            },
          ],
        },
      }

    case 'zero-height-root':
      return {
        ...sample,
        msgs: {
          ...sample.msgs,
          exceptions: [],
        },
        root: {
          ...sample.root,
          exists: true,
          clientHeight: 0,
          rectHeight: 0,
          display: 'block',
          visibility: 'visible',
        },
      }

    case 'empty-graph-no-roots':
      return {
        ...sample,
        msgs: {
          ...sample.msgs,
          exceptions: [],
        },
        state: {
          ...sample.state,
          loadedRoots: [],
          graphNodeCount: 0,
          projectedNodeCount: 0,
        },
        root: {
          ...sample.root,
          exists: true,
          clientHeight: Math.max(sample.root.clientHeight, 600),
          rectHeight: Math.max(sample.root.rectHeight, 600),
          display: 'block',
          visibility: 'visible',
        },
      }

    case 'css-hidden-root':
      return {
        ...sample,
        msgs: {
          ...sample.msgs,
          exceptions: [],
        },
        root: {
          ...sample.root,
          exists: true,
          display: 'none',
          visibility: 'hidden',
        },
      }

    case 'projected-empty':
      return {
        ...sample,
        msgs: {
          ...sample.msgs,
          exceptions: [],
        },
        state: {
          ...sample.state,
          graphNodeCount: Math.max(sample.state.graphNodeCount, 1),
          projectedNodeCount: 0,
        },
        root: {
          ...sample.root,
          exists: true,
          clientHeight: Math.max(sample.root.clientHeight, 600),
          rectHeight: Math.max(sample.root.rectHeight, 600),
          display: 'block',
          visibility: 'visible',
        },
      }
  }
}

async function connectPrimaryPage(
  instance: DebugInstance,
  chromium: ChromiumLike,
): Promise<{ browser: BrowserLike; page: PageLike } | CommandError> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  try {
    const browser = await chromium.connectOverCDP(endpoint)
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      await browser.close().catch(() => undefined)
      return err('why-blank', 'CDP connected but no pages found', 'verify app is fully started')
    }
    return { browser, page: pages[0] }
  } catch (e) {
    return err(
      'why-blank',
      `CDP connect failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  }
}

async function whyBlankHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    return err('why-blank', parsed.message, parsed.hint, 2)
  }

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, { port: parsed.port, pid: parsed.pid, vault: parsed.vault })
  if (!pick.ok) {
    return err('why-blank', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('why-blank', String(e), undefined, 3)
  }

  const connected = await connectPrimaryPage(pick.instance, chromium)
  if ('ok' in connected) {
    return connected
  }

  const { browser, page } = connected
  try {
    const transport = createLiveTransport(pick.instance.mcpPort)
    const [shot, msgs, liveState, root] = await Promise.all([
      fetchShot(page),
      fetchMessages(page),
      transport.getLiveState(),
      fetchRootDomInfo(page),
    ])

    const seeded = applySeed(parsed.seed, {
      shot,
      msgs,
      state: summarizeState(liveState),
      root,
    })

    return ok('why-blank', diagnose(seeded.shot, seeded.msgs, seeded.state, seeded.root))
  } catch (e) {
    return err('why-blank', `diagnosis failed: ${String(e)}`, undefined, 3)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

registerCommand('why-blank', whyBlankHandler)
