import { resolveDebugInstance } from '../debug/portResolution'
import { normalizeChord } from '../debug/normalizeChord'
import { pressChord } from '../debug/pressChord'
import { err, ok } from '../debug/Response'
import { openDebugSession, type PageLike } from '../debug/playwrightSession'
import type { Response } from '../debug/Response'
import { registerCommand } from './index'

type ActiveElementInfo = {
  tag: string
  id?: string
  selector?: string
} | null

type KeyboardResult = {
  focusAfter: ActiveElementInfo
  selector?: string
  normalizedChord?: string
}

type CommonOpts = {
  selector?: string
  port?: number
  pid?: number
  vault?: string
}

type TypeOpts = CommonOpts & {
  text: string
  delayMs?: number
}

type PressOpts = CommonOpts & {
  chord: string
}

const READ_ACTIVE_ELEMENT_SOURCE = String.raw`(() => {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return null

  const escapeCss = (value) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value)
    }
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/ /g, '\\ ')
  }

  const selector = active.id
    ? '#' + escapeCss(active.id)
    : active.getAttribute('data-testid')
      ? '[data-testid="' + escapeCss(active.getAttribute('data-testid') ?? '') + '"]'
      : active.getAttribute('name')
        ? active.tagName.toLowerCase() + '[name="' + escapeCss(active.getAttribute('name') ?? '') + '"]'
        : active.classList.length > 0
          ? active.tagName.toLowerCase() + '.' + Array.from(active.classList).slice(0, 2).map(escapeCss).join('.')
          : active.tagName.toLowerCase()

  return {
    tag: active.tagName,
    ...(active.id ? { id: active.id } : {}),
    ...(selector ? { selector } : {}),
  }
})()`

function usage(message?: string): Response<never> {
  return err(
    'keyboard',
    message ?? 'usage: vt-debug keyboard <type|press> ...',
    [
      "type <text> [--selector <css>] [--delay-ms <ms>]",
      "press <chord> [--selector <css>]",
      "[--port <n> | --cdpPort <n> | --pid <n> | --vault <path>]",
    ].join(' '),
  )
}

function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

function parseTypeArgs(argv: string[]): TypeOpts | Response<never> {
  const positional: string[] = []
  let selector: string | undefined
  let delayMs: number | undefined
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--selector') {
        selector = readFlagValue('--selector', argv[++i])
      } else if (arg.startsWith('--selector=')) {
        selector = readFlagValue('--selector', arg.slice('--selector='.length))
      } else if (arg === '--delay-ms') {
        delayMs = parseNumber('--delay-ms', argv[++i])
      } else if (arg.startsWith('--delay-ms=')) {
        delayMs = parseNumber('--delay-ms', arg.slice('--delay-ms='.length))
      } else if (arg === '--port' || arg === '--cdpPort') {
        port = parseNumber('--port', argv[++i])
      } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        port = parseNumber('--port', arg.slice(arg.indexOf('=') + 1))
      } else if (arg === '--pid') {
        pid = parseNumber('--pid', argv[++i])
      } else if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
      } else if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[++i])
      } else if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
      } else if (arg.startsWith('--')) {
        return usage(`unknown argument: ${arg}`)
      } else {
        positional.push(arg)
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (delayMs !== undefined && delayMs < 0) return usage('--delay-ms must be >= 0')

  const text = positional.join(' ')
  if (positional.length === 0) {
    return usage('keyboard type requires text')
  }

  return { text, selector, delayMs, port, pid, vault }
}

function parsePressArgs(argv: string[]): PressOpts | Response<never> {
  const positional: string[] = []
  let selector: string | undefined
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--selector') {
        selector = readFlagValue('--selector', argv[++i])
      } else if (arg.startsWith('--selector=')) {
        selector = readFlagValue('--selector', arg.slice('--selector='.length))
      } else if (arg === '--port' || arg === '--cdpPort') {
        port = parseNumber('--port', argv[++i])
      } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        port = parseNumber('--port', arg.slice(arg.indexOf('=') + 1))
      } else if (arg === '--pid') {
        pid = parseNumber('--pid', argv[++i])
      } else if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
      } else if (arg === '--vault') {
        vault = readFlagValue('--vault', argv[++i])
      } else if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
      } else if (arg.startsWith('--')) {
        return usage(`unknown argument: ${arg}`)
      } else {
        positional.push(arg)
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (positional.length !== 1 || positional[0].trim() === '') {
    return usage('keyboard press requires one chord argument')
  }

  return { chord: positional[0], selector, port, pid, vault }
}

async function readActiveElement(page: PageLike): Promise<ActiveElementInfo> {
  return page.evaluate(READ_ACTIVE_ELEMENT_SOURCE)
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

async function resolveTarget(opts: CommonOpts) {
  const pick = await resolveDebugInstance({ port: opts.port, pid: opts.pid, vault: opts.vault })
  if (!pick.ok) {
    return { ok: false as const, response: err('keyboard', pick.message, pick.hint, 2) }
  }
  return { ok: true as const, instance: pick.instance }
}

async function keyboardType(opts: TypeOpts): Promise<Response<KeyboardResult>> {
  const target = await resolveTarget(opts)
  if (!target.ok) return target.response

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(target.instance)
  } catch (e) {
    return err('keyboard type', String(e), undefined, 3)
  }

  try {
    const page = session.pages[0]
    if (!page) {
      return err('keyboard type', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }
    if (opts.selector) {
      await focusTarget(page, opts.selector)
    }
    await page.keyboard.type(opts.text, opts.delayMs !== undefined ? { delay: opts.delayMs } : undefined)
    return ok('keyboard type', {
      focusAfter: await readActiveElement(page),
      ...(opts.selector ? { selector: opts.selector } : {}),
    })
  } catch (e) {
    return err('keyboard type', String(e))
  } finally {
    await session.close()
  }
}

async function keyboardPress(opts: PressOpts): Promise<Response<KeyboardResult>> {
  const target = await resolveTarget(opts)
  if (!target.ok) return target.response

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(target.instance)
  } catch (e) {
    return err('keyboard press', String(e), undefined, 3)
  }

  try {
    const page = session.pages[0]
    if (!page) {
      return err('keyboard press', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }
    if (opts.selector) {
      await focusTarget(page, opts.selector)
    }
    const normalizedChord = normalizeChord(opts.chord)
    await pressChord(page, normalizedChord)
    return ok('keyboard press', {
      focusAfter: await readActiveElement(page),
      normalizedChord,
      ...(opts.selector ? { selector: opts.selector } : {}),
    })
  } catch (e) {
    return err('keyboard press', String(e))
  } finally {
    await session.close()
  }
}

async function keyboardHandler(argv: string[]): Promise<Response<unknown>> {
  const [op, ...rest] = argv
  if (!op) {
    return usage('keyboard requires an operation: type or press')
  }

  if (op === 'type') {
    const parsed = parseTypeArgs(rest)
    return 'ok' in parsed ? parsed : keyboardType(parsed)
  }

  if (op === 'press') {
    const parsed = parsePressArgs(rest)
    return 'ok' in parsed ? parsed : keyboardPress(parsed)
  }

  return usage(`unknown keyboard operation: ${op}`)
}

registerCommand('keyboard', keyboardHandler)
