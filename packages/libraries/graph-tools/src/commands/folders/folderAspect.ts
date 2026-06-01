import { registerCommand } from '../index'
import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { openDebugSession } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { err, ok } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'
import { parseCyDump, type CyDump } from '@vt/graph-tools/debug/state/cyStateShape'
import { computeFolderAspects, type FolderAspectReport } from '@vt/graph-tools/view/folderAspect'

interface PageLike {
  evaluate<T>(fn: () => T): Promise<T>
}

export type FolderAspectOptions = {
  threshold: number
  minChildren: number
  port?: number
  pid?: number
  project?: string
}

function parseNumberFlag(raw: string, flagName: string): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} expects a number, got "${raw}"`)
  }
  return parsed
}

function parseIntegerFlag(raw: string, flagName: string): number {
  const parsed = parseNumberFlag(raw, flagName)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flagName} expects an integer, got "${raw}"`)
  }
  return parsed
}

export function parseArgs(argv: string[]): FolderAspectOptions | Response<never> {
  const options: FolderAspectOptions = {
    threshold: 3,
    minChildren: 3,
  }

  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]
      if (arg === '--threshold') {
        options.threshold = parseNumberFlag(argv[++i] ?? '', '--threshold')
      } else if (arg.startsWith('--threshold=')) {
        options.threshold = parseNumberFlag(arg.slice('--threshold='.length), '--threshold')
      } else if (arg === '--min-children') {
        options.minChildren = parseIntegerFlag(argv[++i] ?? '', '--min-children')
      } else if (arg.startsWith('--min-children=')) {
        options.minChildren = parseIntegerFlag(arg.slice('--min-children='.length), '--min-children')
      } else if (arg === '--port' || arg === '--cdpPort') {
        options.port = parseIntegerFlag(argv[++i] ?? '', '--port')
      } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
        options.port = parseIntegerFlag(arg.slice(arg.indexOf('=') + 1), '--port')
      } else if (arg === '--pid') {
        options.pid = parseIntegerFlag(argv[++i] ?? '', '--pid')
      } else if (arg.startsWith('--pid=')) {
        options.pid = parseIntegerFlag(arg.slice('--pid='.length), '--pid')
      } else if (arg === '--project') {
        options.project = argv[++i]
        if (!options.project || options.project.startsWith('--')) {
          return err('folder-aspect', '--project requires a value')
        }
      } else if (arg.startsWith('--project=')) {
        options.project = arg.slice('--project='.length)
        if (!options.project) {
          return err('folder-aspect', '--project requires a value')
        }
      } else {
        return err(
          'folder-aspect',
          `unknown arg: ${arg}`,
          'supported flags: --threshold, --min-children, --port, --cdpPort, --pid, --project',
        )
      }
    }
  } catch (e) {
    return err(
      'folder-aspect',
      String(e),
      'supported flags: --threshold, --min-children, --port, --cdpPort, --pid, --project',
    )
  }

  return options
}

async function fetchRendered(page: PageLike): Promise<CyDump> {
  const raw = await page.evaluate(() => {
    const helper = (window as unknown as Record<string, unknown>)['__vtDebug__']
    if (!helper) return null
    const cy = (helper as Record<string, unknown>)['cy']
    return typeof cy === 'function' ? (cy as () => unknown)() : null
  })

  if (raw === null) {
    throw new Error('window.__vtDebug__.cy() unavailable')
  }

  return parseCyDump(raw)
}

export async function folderAspect(
  page: PageLike,
  opts: { threshold?: number; minChildren?: number } = {},
): Promise<Response<FolderAspectReport>> {
  try {
    const dump = await fetchRendered(page)
    const result = computeFolderAspects(dump, {
      threshold: opts.threshold,
      minChildCount: opts.minChildren,
    })
    return ok('folder-aspect', result)
  } catch (e) {
    return err('folder-aspect', String(e))
  }
}

async function folderAspectHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if ('ok' in parsed) {
    return parsed
  }

  const pick = await resolveDebugInstance({ port: parsed.port, pid: parsed.pid, project: parsed.project })
  if (!pick.ok) {
    return err('folder-aspect', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(pick.instance)
    const [page] = session.pages
    if (!page) {
      return err('folder-aspect', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const response = await folderAspect(page, {
      threshold: parsed.threshold,
      minChildren: parsed.minChildren,
    })

    if (!response.ok) {
      return {
        ...response,
        hint: response.hint ?? 'verify the dev instance is running with CDP enabled and cy is initialized',
        exitCode: 3,
      }
    }

    return response
  } catch (e) {
    return err(
      'folder-aspect',
      String(e),
      'verify the dev instance is running with CDP enabled and cy is initialized',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('folder-aspect', folderAspectHandler)
