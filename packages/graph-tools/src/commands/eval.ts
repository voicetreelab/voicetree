import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import { err, ok } from '../debug/Response'
import { filterLive, pickInstance, readInstancesDir, type DebugInstance } from '../debug/discover'
import type { Response } from '../debug/Response'
import { registerCommand } from './index'

interface PageLike {
  evaluate<T, Arg>(pageFunction: (arg: Arg) => T | Promise<T>, arg: Arg): Promise<T>
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

type ErrorResponse = Extract<Response<never>, { ok: false }>

type EvalOptions = {
  port?: number
  pid?: number
  vault?: string
  source: string
}

type EvalPayload = {
  expression: string
  serializeFnSource: string
}

const SERIALIZE_EVAL_VALUE_SOURCE = String.raw`
function serializeEvalValue(value) {
  const seen = new WeakSet()

  function stringifyFallback(input) {
    const ctorName =
      typeof input.constructor === 'function' && input.constructor.name
        ? input.constructor.name
        : ''
    const text = String(input)

    if (text !== '[object Object]' && text !== '[object Function]') {
      return text
    }

    return ctorName ? '[' + ctorName + ']' : text
  }

  function isDomLikeNode(input) {
    return 'nodeType' in input && typeof input.nodeType === 'number'
  }

  function walk(input) {
    if (input === null) return null

    const kind = typeof input
    if (kind === 'string' || kind === 'number' || kind === 'boolean') return input
    if (kind === 'undefined') return 'undefined'
    if (kind === 'bigint' || kind === 'symbol' || kind === 'function') return String(input)

    if (!(input instanceof Object)) {
      return String(input)
    }

    if (seen.has(input)) return '[Circular]'
    seen.add(input)

    if (isDomLikeNode(input)) {
      if (input.nodeType === 1) {
        const tag = typeof input.tagName === 'string' ? input.tagName.toLowerCase() : 'element'
        const id = typeof input.id === 'string' && input.id ? '#' + input.id : ''
        const className =
          typeof input.className === 'string' && input.className.trim()
            ? '.' + input.className.trim().split(/\s+/).join('.')
            : ''
        return '<' + tag + id + className + '>'
      }

      return typeof input.nodeName === 'string' ? input.nodeName : '[Node]'
    }

    if (Array.isArray(input)) return input.map(item => walk(item))
    if (input instanceof Date) return input.toISOString()
    if (input instanceof RegExp) return String(input)
    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
        ...(input.stack ? { stack: input.stack } : {}),
      }
    }

    if (input instanceof Map) {
      return {
        $type: 'Map',
        entries: [...input.entries()].map(([key, entryValue]) => [walk(key), walk(entryValue)]),
      }
    }

    if (input instanceof Set) {
      return {
        $type: 'Set',
        values: [...input.values()].map(entryValue => walk(entryValue)),
      }
    }

    const proto = Object.getPrototypeOf(input)
    if (proto !== Object.prototype && proto !== null) {
      return stringifyFallback(input)
    }

    const out = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!descriptor.enumerable) continue
      if ('value' in descriptor) {
        out[key] = walk(descriptor.value)
        continue
      }

      const labels = []
      if (typeof descriptor.get === 'function') labels.push('Getter')
      if (typeof descriptor.set === 'function') labels.push('Setter')
      out[key] = '[' + (labels.join('/') || 'Accessor') + ']'
    }

    return out
  }

  return walk(value)
}
`

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

export function serializeEvalValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  function stringifyFallback(input: object): string {
    const ctorName =
      typeof input.constructor === 'function' && input.constructor.name
        ? input.constructor.name
        : ''
    const text = String(input)

    if (text !== '[object Object]' && text !== '[object Function]') {
      return text
    }

    return ctorName ? `[${ctorName}]` : text
  }

  function isDomLikeNode(input: object): input is {
    nodeType: unknown
    nodeName?: unknown
    tagName?: unknown
    id?: unknown
    className?: unknown
  } {
    return 'nodeType' in input && typeof (input as { nodeType?: unknown }).nodeType === 'number'
  }

  function walk(input: unknown): unknown {
    if (input === null) return null

    const kind = typeof input
    if (kind === 'string' || kind === 'number' || kind === 'boolean') return input
    if (kind === 'undefined') return 'undefined'
    if (kind === 'bigint' || kind === 'symbol' || kind === 'function') return String(input)

    if (!(input instanceof Object)) {
      return String(input)
    }

    if (seen.has(input)) return '[Circular]'
    seen.add(input)

    if (isDomLikeNode(input)) {
      if (input.nodeType === 1) {
        const tag = typeof input.tagName === 'string' ? input.tagName.toLowerCase() : 'element'
        const id = typeof input.id === 'string' && input.id ? `#${input.id}` : ''
        const className =
          typeof input.className === 'string' && input.className.trim()
            ? `.${input.className.trim().split(/\s+/).join('.')}`
            : ''
        return `<${tag}${id}${className}>`
      }

      return typeof input.nodeName === 'string' ? input.nodeName : '[Node]'
    }

    if (Array.isArray(input)) return input.map(item => walk(item))
    if (input instanceof Date) return input.toISOString()
    if (input instanceof RegExp) return String(input)
    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
        ...(input.stack ? { stack: input.stack } : {}),
      }
    }

    if (input instanceof Map) {
      return {
        $type: 'Map',
        entries: [...input.entries()].map(([key, entryValue]) => [walk(key), walk(entryValue)]),
      }
    }

    if (input instanceof Set) {
      return {
        $type: 'Set',
        values: [...input.values()].map(entryValue => walk(entryValue)),
      }
    }

    const proto = Object.getPrototypeOf(input)
    if (proto !== Object.prototype && proto !== null) {
      return stringifyFallback(input)
    }

    const out: Record<string, unknown> = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!descriptor.enumerable) continue
      if ('value' in descriptor) {
        out[key] = walk(descriptor.value)
        continue
      }

      const labels = []
      if (typeof descriptor.get === 'function') labels.push('Getter')
      if (typeof descriptor.set === 'function') labels.push('Setter')
      out[key] = `[${labels.join('/') || 'Accessor'}]`
    }

    return out
  }

  return walk(value)
}

async function evaluateSource(page: PageLike, source: string): Promise<unknown> {
  const payload: EvalPayload = {
    expression: source,
    serializeFnSource: SERIALIZE_EVAL_VALUE_SOURCE,
  }

  return page.evaluate(
    async ({ expression, serializeFnSource }: EvalPayload) => {
      const serialize = (0, eval)(`(${serializeFnSource})`) as (value: unknown) => unknown
      try {
        const value = await (0, eval)(expression)
        return serialize(value)
      } catch (error) {
        const detail =
          error instanceof Error
            ? [error.name, error.message, error.stack].filter(Boolean).join('\n')
            : String(error)
        throw new Error(detail)
      }
    },
    payload,
  )
}

function parseIntFlag(command: string, flag: string, rawValue: string | undefined): ErrorResponse | number {
  if (!rawValue || rawValue.startsWith('--')) {
    return err(command, `${flag} requires a value`)
  }

  const parsed = parseInt(rawValue, 10)
  if (!Number.isFinite(parsed)) {
    return err(command, `${flag} must be an integer`)
  }

  return parsed
}

function parseEvalOptions(argv: string[]): ErrorResponse | EvalOptions {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined
  const sourceParts: string[] = []
  let parsingFlags = true

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (parsingFlags && arg === '--') {
      parsingFlags = false
      continue
    }

    if (parsingFlags && arg === '--port') {
      const parsed = parseIntFlag('eval', '--port', argv[++i])
      if (typeof parsed !== 'number') return parsed
      port = parsed
      continue
    }

    if (parsingFlags && arg.startsWith('--port=')) {
      const parsed = parseIntFlag('eval', '--port', arg.slice('--port='.length))
      if (typeof parsed !== 'number') return parsed
      port = parsed
      continue
    }

    if (parsingFlags && arg === '--pid') {
      const parsed = parseIntFlag('eval', '--pid', argv[++i])
      if (typeof parsed !== 'number') return parsed
      pid = parsed
      continue
    }

    if (parsingFlags && arg.startsWith('--pid=')) {
      const parsed = parseIntFlag('eval', '--pid', arg.slice('--pid='.length))
      if (typeof parsed !== 'number') return parsed
      pid = parsed
      continue
    }

    if (parsingFlags && arg === '--vault') {
      const next = argv[++i]
      if (!next || next.startsWith('--')) {
        return err('eval', '--vault requires a value')
      }
      vault = next
      continue
    }

    if (parsingFlags && arg.startsWith('--vault=')) {
      vault = arg.slice('--vault='.length)
      continue
    }

    if (parsingFlags && arg.startsWith('--')) {
      return err('eval', `unknown argument: ${arg}`, 'use -- before expressions that start with --')
    }

    parsingFlags = false
    sourceParts.push(arg)
  }

  if (sourceParts.length === 0) {
    return err('eval', 'no JavaScript expression given', 'usage: vt-debug eval <js> [--port N|--pid N|--vault PATH]')
  }

  return {
    port,
    pid,
    vault,
    source: sourceParts.join(' '),
  }
}

async function evalInInstance(
  instance: DebugInstance,
  chromium: ChromiumLike,
  source: string,
): Promise<Response<unknown>> {
  const endpoint = `http://localhost:${instance.cdpPort}`
  let browser: BrowserLike | null = null

  try {
    browser = await chromium.connectOverCDP(endpoint)
  } catch (e) {
    return err(
      'eval',
      `CDP connect failed: ${String(e)}`,
      'Is ENABLE_PLAYWRIGHT_DEBUG=1 set and Voicetree running in dev mode?',
      3,
    )
  }

  try {
    const pages = browser.contexts().flatMap(ctx => ctx.pages())
    if (pages.length === 0) {
      return err('eval', 'CDP connected but no pages found', 'verify app is fully started')
    }

    const result = await evaluateSource(pages[0], source)
    return ok('eval', result)
  } catch (e) {
    return err('eval', `page evaluation failed: ${String(e)}`)
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}

async function evalHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseEvalOptions(argv)
  if ('ok' in parsed) return parsed

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, {
    port: parsed.port,
    pid: parsed.pid,
    vault: parsed.vault,
  })

  if (!pick.ok) {
    return err('eval', pick.message, pick.hint, 2)
  }

  let chromium: ChromiumLike
  try {
    chromium = await resolveChromium()
  } catch (e) {
    return err('eval', String(e), undefined, 3)
  }

  return evalInInstance(pick.instance, chromium, parsed.source)
}

registerCommand('eval', evalHandler)
