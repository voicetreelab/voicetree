import path from 'node:path'

import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { err, ok } from '@vt/graph-tools/debug/protocol/Response'
import { openDebugSession } from '@vt/graph-tools/debug/protocol/playwrightSession'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'
import {
  consumeDebugTargetFlag,
  parseIntegerFlag,
  readFlagValue,
  type DebugTargetArgs,
} from '../core/argv'
import { registerCommand } from '../index'
import { folderMaterializeImplementation } from './folderMaterialize/implementation'

const {
  DEFAULT_TIMEOUT_MS,
  createScratchFixture,
  folderMaterialize,
  waitForGraphReady,
  withTrailingSlash,
} = folderMaterializeImplementation

type FloatingEditorRect = {
  id: string
  x: number
  y: number
  w: number
  h: number
  intersectsViewport: boolean
}

type DomProbes = {
  cyNodeCount: number
  floatingEditors: string[]
  floatingEditorRects: FloatingEditorRect[]
  selectedNodeHasEditor: boolean
}

export type FolderMaterializeOptions = {
  folder?: string
  keepFixture: boolean
  marker?: string
  pid?: number
  port?: number
  timeoutMs: number
  project?: string
}

export type ScratchFixture = {
  folderId: string
  folderPath: string
  seedFilePath: string
}

export type FolderMaterializeResult = {
  cleanupError?: string
  cleanupPerformed: boolean
  cdpPort: number
  domProbesAfterTap: DomProbes
  domProbesAfterType: DomProbes
  domProbesBeforeTap: DomProbes
  editorSelector: string
  editorWindowId: string
  fixtureCreated: boolean
  folderId: string
  indexExistedBefore: boolean
  indexPath: string
  marker: string
  materializedNow: boolean
  pid: number
  savedContentLength: number
  savedContentPreview: string
  seedFilePath?: string
  projectRoot: string
  writeFolderPath: string
}

export { createScratchFixture, folderMaterialize }

function usage(message?: string): Response<never> {
  return err(
    'folder-materialize',
    message ?? 'usage: vt debug folder materialize [flags]',
    [
      '[--folder <absolute-folder-id>]',
      '[--marker <text>]',
      '[--timeout-ms <ms>]',
      '[--keep-fixture]',
      '[--port <n> | --cdpPort <n> | --pid <n> | --project <path>]',
    ].join(' '),
  )
}

export function parseArgs(argv: string[]): FolderMaterializeOptions | Response<never> {
  let folder: string | undefined
  let keepFixture = false
  let marker: string | undefined
  let timeoutMs = DEFAULT_TIMEOUT_MS
  const target: DebugTargetArgs = {}

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]
      if (arg === '--folder') {
        folder = path.resolve(readFlagValue('--folder', argv[++i]))
      } else if (arg.startsWith('--folder=')) {
        folder = path.resolve(readFlagValue('--folder', arg.slice('--folder='.length)))
      } else if (arg === '--marker') {
        marker = readFlagValue('--marker', argv[++i])
      } else if (arg.startsWith('--marker=')) {
        marker = readFlagValue('--marker', arg.slice('--marker='.length))
      } else if (arg === '--timeout-ms') {
        timeoutMs = parseIntegerFlag('--timeout-ms', argv[++i])
      } else if (arg.startsWith('--timeout-ms=')) {
        timeoutMs = parseIntegerFlag('--timeout-ms', arg.slice('--timeout-ms='.length))
      } else if (arg === '--keep-fixture') {
        keepFixture = true
      } else {
        const debugTargetFlag = consumeDebugTargetFlag(argv, i, target, { resolveProject: true })
        if (!debugTargetFlag.matched) {
          return usage(`unknown argument: ${arg}`)
        }
        i = debugTargetFlag.nextIndex
      }
    }
  } catch (e) {
    return usage(String(e))
  }

  if (timeoutMs <= 0) {
    return usage('--timeout-ms must be > 0')
  }

  return {
    ...(folder ? { folder: withTrailingSlash(folder) } : {}),
    keepFixture,
    ...(marker ? { marker } : {}),
    ...(target.pid !== undefined ? { pid: target.pid } : {}),
    ...(target.port !== undefined ? { port: target.port } : {}),
    timeoutMs,
    ...(target.project ? { project: target.project } : {}),
  }
}

async function folderMaterializeHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if ('ok' in parsed) {
    return parsed
  }

  const pick = await resolveDebugInstance({ port: parsed.port, pid: parsed.pid, project: parsed.project })
  if (!pick.ok) {
    return err('folder-materialize', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(pick.instance)
    const [page] = session.pages
    if (!page) {
      return err('folder-materialize', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const interactivePage = page as Parameters<typeof folderMaterialize>[0]
    const writeFolderPath = await waitForGraphReady(interactivePage, parsed.timeoutMs)
    const selectedProjectPath = parsed.project ?? (pick.instance.projectRoot || writeFolderPath)
    const response = await folderMaterialize(interactivePage, {
      ...(parsed.folder ? { folder: parsed.folder } : {}),
      keepFixture: parsed.keepFixture,
      ...(parsed.marker ? { marker: parsed.marker } : {}),
      timeoutMs: parsed.timeoutMs,
      projectRoot: selectedProjectPath,
      writeFolderPath,
    })

    if (!response.ok) {
      return {
        ...response,
        exitCode: 1,
      }
    }

    return ok('folder-materialize', {
      ...response.result,
      cdpPort: pick.instance.cdpPort,
      pid: pick.instance.pid,
      projectRoot: path.resolve(selectedProjectPath || response.result.projectRoot),
    })
  } catch (e) {
    return err(
      'folder-materialize',
      String(e),
      'verify the dev instance is running with CDP enabled and the graph is loaded',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('folder-materialize', folderMaterializeHandler)
