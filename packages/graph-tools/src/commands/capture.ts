import fs from 'fs/promises'
import path from 'path'
import { serializeState } from '@vt/graph-state'
import { registerCommand } from './index'
import { resolveDebugInstance } from '../debug/portResolution'
import { err, ok } from '../debug/Response'
import type { Response } from '../debug/Response'
import { parseCyDump, type CyDump } from '../debug/cyStateShape'
import { createLiveTransport } from '../liveTransport'
import type { FocusedElement, Snapshot } from '../debug/captureDiff'
import { openDebugSession, type PageLike } from '../debug/playwrightSession'

const CAPTURES_DIR = '/tmp/vt-debug/captures'

type CaptureArgs = {
  port?: number
  pid?: number
  vault?: string
  tag?: string
  out?: string
}

function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback
}

function splitClasses(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw.trim().split(/\s+/)
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

function coerceCyDump(raw: unknown): CyDump | null {
  if (raw === null || raw === undefined) return null

  const record = raw as Record<string, unknown>
  if ('elements' in record) {
    return parseCyDump(raw)
  }

  const nodes = Array.isArray(record.nodes) ? record.nodes as Record<string, unknown>[] : []
  const edges = Array.isArray(record.edges) ? record.edges as Record<string, unknown>[] : []
  const viewport = (record.viewport as Record<string, unknown>) ?? {}
  const pan = (viewport.pan as Record<string, unknown>) ?? {}

  return {
    nodes: nodes.map(node => ({
      id: String(node.id ?? ''),
      classes: Array.isArray(node.classes) ? node.classes.map(String) : splitClasses(node.classes),
      position: {
        x: safeNum((node.position as Record<string, unknown> | undefined)?.x),
        y: safeNum((node.position as Record<string, unknown> | undefined)?.y),
      },
      visible: node.visible !== false,
    })),
    edges: edges.map(edge => ({
      id: String(edge.id ?? ''),
      source: String(edge.source ?? ''),
      target: String(edge.target ?? ''),
      classes: Array.isArray(edge.classes) ? edge.classes.map(String) : splitClasses(edge.classes),
    })),
    viewport: {
      zoom: safeNum(viewport.zoom, 1),
      pan: { x: safeNum(pan.x), y: safeNum(pan.y) },
    },
    selection: Array.isArray(record.selection)
      ? record.selection.map(String)
      : nodes
          .filter(node =>
            (Array.isArray(node.classes) ? node.classes.map(String) : splitClasses(node.classes))
              .includes('selected'))
          .map(node => String(node.id ?? '')),
  }
}

async function readFocusedElement(page: PageLike): Promise<FocusedElement | null> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null

    const dataNodeId = el.getAttribute('data-node-id') ?? undefined
    const role = el.getAttribute('role') ?? undefined
    return {
      tag: el.tagName.toLowerCase(),
      ...(el.id ? { id: el.id } : {}),
      ...(role ? { role } : {}),
      ...(dataNodeId ? { dataNodeId } : {}),
    }
  })
}

function parseArgs(argv: string[]): CaptureArgs {
  const args: CaptureArgs = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '--cdpPort') {
      args.port = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--port=') || arg.startsWith('--cdpPort=')) {
      args.port = parseInt(arg.slice(arg.indexOf('=') + 1), 10)
    } else if (arg === '--pid') {
      args.pid = parseInt(argv[++i] ?? '', 10)
    } else if (arg.startsWith('--pid=')) {
      args.pid = parseInt(arg.slice('--pid='.length), 10)
    } else if (arg === '--vault') {
      args.vault = argv[++i]
    } else if (arg.startsWith('--vault=')) {
      args.vault = arg.slice('--vault='.length)
    } else if (arg === '--tag') {
      args.tag = argv[++i]
    } else if (arg.startsWith('--tag=')) {
      args.tag = arg.slice('--tag='.length)
    } else if (arg === '--out') {
      args.out = argv[++i]
    } else if (arg.startsWith('--out=')) {
      args.out = arg.slice('--out='.length)
    }
  }

  return args
}

function buildCapturePath(timestamp: string, args: CaptureArgs): string {
  if (args.out) return path.resolve(args.out)
  if (args.tag) return path.join(CAPTURES_DIR, `${sanitizeTag(args.tag)}.json`)
  return path.join(CAPTURES_DIR, `${timestamp.replace(/[:.]/g, '-')}.json`)
}

async function captureHandler(argv: string[]): Promise<Response<unknown>> {
  const args = parseArgs(argv)
  const pick = await resolveDebugInstance({
    port: args.port,
    pid: args.pid,
    vault: args.vault,
  })

  if (!pick.ok) {
    return err('capture', pick.message, pick.hint, 2)
  }

  let session: Awaited<ReturnType<typeof openDebugSession>> | null = null
  try {
    const transport = createLiveTransport(pick.instance.mcpPort)
    session = await openDebugSession(pick.instance)
    const page = session.pages[0]
    if (!page) {
      return err('capture', 'CDP connected but no pages found', 'verify app is fully started', 3)
    }
    const [state, rawCyDump, focused] = await Promise.all([
      transport.getLiveState(),
      page.evaluate(() => (
        (window as unknown as { __vtDebug__?: { cy?: () => unknown } }).__vtDebug__?.cy?.() ?? null
      )),
      readFocusedElement(page),
    ])

    const serializedState = serializeState(state)
    const cyDump = coerceCyDump(rawCyDump)
    const timestamp = new Date().toISOString()
    const snapshot: Snapshot = {
      state: serializedState,
      cyDump,
      focused,
      selection: [...serializedState.selection],
      zoom: cyDump?.viewport.zoom ?? serializedState.layout.zoom ?? null,
      pan: cyDump?.viewport.pan ?? serializedState.layout.pan ?? null,
      timestamp,
    }

    const outputPath = buildCapturePath(timestamp, args)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')

    return ok('capture', { path: outputPath, timestamp })
  } catch (e) {
    return err('capture', String(e), undefined, 3)
  } finally {
    if (session) {
      await session.close()
    }
  }
}

registerCommand('capture', captureHandler)
