import fs from 'node:fs/promises'
import type { State } from '@vt/graph-state'
import { registerCommand } from './index'
import { readInstancesDir, filterLive, pickInstance } from '../debug/discover'
import { computeDrift, type DriftData, type FsContentById } from '../debug/drift'
import { openDebugSession, type PageLike } from '../debug/playwrightSession'
import { projectStateToCyDump } from '../debug/projectedCyDump'
import { ok, err } from '../debug/Response'
import { parseCyDump, type CyDump } from '../debug/cyStateShape'
import { createLiveTransport } from '../liveTransport'
import type { Response } from '../debug/Response'

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

async function snapshotFsContent(state: State): Promise<FsContentById> {
  const entries = await Promise.all(
    Object.keys(state.graph.nodes).map(async (nodeId) => {
      try {
        const content = await fs.readFile(nodeId, 'utf8')
        return [nodeId, content] as const
      } catch {
        return [nodeId, null] as const
      }
    }),
  )
  return Object.fromEntries(entries)
}

function parseArgs(argv: string[]): Response<never> | { port?: number; pid?: number; vault?: string; deep: boolean } {
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined
  let deep = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--deep') {
      deep = true
    } else if (arg === '--port') {
      port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10)
    } else if (arg === '--pid') {
      pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      vault = argv[++i]
      if (!vault || vault.startsWith('--')) {
        return err('drift', '--vault requires a value')
      }
    } else if (arg.startsWith('--vault=')) {
      vault = arg.slice('--vault='.length)
      if (!vault) {
        return err('drift', '--vault requires a value')
      }
    } else {
      return err('drift', `unknown arg: ${arg}`)
    }
  }

  return { port, pid, vault, deep }
}

async function driftHandler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if (!('deep' in parsed)) {
    return parsed
  }

  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, { port: parsed.port, pid: parsed.pid, vault: parsed.vault })

  if (!pick.ok) {
    return err('drift', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    session = await openDebugSession(pick.instance)
    const [page] = session.pages
    if (!page) {
      return err('drift', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }

    const transport = createLiveTransport(pick.instance.mcpPort)
    const [state, rendered] = await Promise.all([
      transport.getLiveState(),
      fetchRendered(page),
    ])
    const projected = projectStateToCyDump(state)
    const fsContentById = await snapshotFsContent(state)
    const result = computeDrift(
      {
        ...state,
        fsContentById,
      } satisfies DriftData,
      projected,
      rendered,
      { deep: parsed.deep },
    )

    return ok('drift', result)
  } catch (e) {
    return err(
      'drift',
      String(e),
      'verify the dev instance is running with MCP + CDP enabled and cy is initialized',
      3,
    )
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('drift', driftHandler)
