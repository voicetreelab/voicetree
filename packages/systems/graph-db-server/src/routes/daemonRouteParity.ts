import { CONTRACT_VERSION } from '../daemon/contract.ts'
import { createDaemonApp } from './daemonApp.ts'
import { SessionRegistry } from '../application/session/registry.ts'

const DAEMON_ROUTE_IDS = [
  'graph.delta',
  'graph.delete-node',
  'graph.read',
  'graph.view',
  'session.create',
  'session.delete',
  'session.events',
  'session.show',
  'vault.add-read-path',
  'vault.remove-read-path',
  'vault.set-write-path',
  'vault.show',
  'view.collapse',
  'view.expand',
  'view.layout',
  'view.selection',
  'view.show',
] as const

export type DaemonRouteId = (typeof DAEMON_ROUTE_IDS)[number]

export type DaemonRouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export type NormalizedDaemonRoute = {
  id: DaemonRouteId
  method: DaemonRouteMethod
  path: string
}

export type DaemonRouteExemption = {
  method: DaemonRouteMethod
  path: string
  reason: string
}

const DAEMON_ROUTE_ID_BY_SIGNATURE = {
  'DELETE /graph/node/:encodedNodeId': 'graph.delete-node',
  'DELETE /sessions/:sessionId': 'session.delete',
  'DELETE /sessions/:sessionId/collapse/:folderId': 'view.expand',
  'DELETE /vault/read-paths/:encodedPath': 'vault.remove-read-path',
  'GET /graph': 'graph.read',
  'GET /sessions/:sessionId': 'session.show',
  'GET /sessions/:sessionId/events': 'session.events',
  'GET /sessions/:sessionId/state': 'view.show',
  'GET /sessions/:sessionId/view': 'graph.view',
  'GET /vault': 'vault.show',
  'POST /graph/delta': 'graph.delta',
  'POST /sessions': 'session.create',
  'POST /sessions/:sessionId/collapse/:folderId': 'view.collapse',
  'POST /sessions/:sessionId/selection': 'view.selection',
  'POST /vault/read-paths': 'vault.add-read-path',
  'PUT /sessions/:sessionId/layout': 'view.layout',
  'PUT /vault/write-path': 'vault.set-write-path',
} as const satisfies Record<string, DaemonRouteId>

export const DAEMON_ROUTE_PARITY_EXEMPTIONS = [
  {
    method: 'GET',
    path: '/health',
    reason:
      '`/health` exists for readiness, port discovery, and test orchestration; it is not a user-facing `vt` command.',
  },
  {
    method: 'POST',
    path: '/shutdown',
    reason:
      '`/shutdown` is daemon lifecycle control for teardown and tests; it is not a user-facing `vt` command.',
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/expand/:folderId',
    reason:
      '`/sessions/:sessionId/expand/:folderId` stores persistent render-only expand overrides; current CLI uses one-shot `vt graph structure --expand` query params instead.',
  },
  {
    method: 'DELETE',
    path: '/sessions/:sessionId/expand/:folderId',
    reason:
      '`/sessions/:sessionId/expand/:folderId` clears persistent render-only expand overrides; current CLI has no persistent override command.',
  },
  {
    method: 'GET',
    path: '/sessions/:sessionId/projected-graph',
    reason:
      '`/sessions/:sessionId/projected-graph` returns the full ProjectedGraph for renderer hydration; internal to the Electron IPC bridge, not a CLI command.',
  },
  {
    method: 'GET',
    path: '/graph/find-file',
    reason:
      '`/graph/find-file` is a daemon-internal query used by the webapp IPC bridge for wikilink resolution; not a user-facing CLI command.',
  },
  {
    method: 'GET',
    path: '/graph/preview-contained-nodes/:nodeId',
    reason:
      '`/graph/preview-contained-nodes/:nodeId` computes context node preview highlights for the renderer; not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/undo',
    reason:
      '`/graph/undo` reverses the last graph mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/redo',
    reason:
      '`/graph/redo` re-applies a previously undone mutation; triggered by the webapp IPC bridge, not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node',
    reason:
      '`/graph/context-node` creates transient agent context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node-from-question',
    reason:
      '`/graph/context-node-from-question` creates ask-mode context files for Electron/headless agent workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/context-node-from-selected-nodes',
    reason:
      '`/graph/context-node-from-selected-nodes` creates transient agent context files for Electron selected-node workflows; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/unseen-nodes-around-context-node',
    reason:
      '`/graph/unseen-nodes-around-context-node` collects agent context for MCP orchestration; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/apply-delta',
    reason:
      '`/graph/apply-delta` is the option-aware mutation endpoint used by Electron/MCP bridges; the user-facing CLI remains covered by `/graph/delta`.',
  },
  {
    method: 'PATCH',
    path: '/graph/context-node-contained-ids',
    reason:
      '`/graph/context-node-contained-ids` updates MCP context-node bookkeeping; it is not a user-facing CLI command.',
  },
  {
    method: 'POST',
    path: '/graph/write-positions',
    reason:
      '`/graph/write-positions` persists renderer layout coordinates from Electron; it is not a user-facing CLI command.',
  },
] as const satisfies readonly DaemonRouteExemption[]

function isExemptRouteSignature(signature: string): boolean {
  return DAEMON_ROUTE_PARITY_EXEMPTIONS.some(
    route => signature === `${route.method} ${route.path}`,
  )
}

function toDaemonRouteMethod(method: string): DaemonRouteMethod {
  switch (method) {
    case 'DELETE':
    case 'GET':
    case 'PATCH':
    case 'POST':
    case 'PUT':
      return method
    default:
      throw new Error(`Unsupported daemon route method: ${method}`)
  }
}

function createParityIntrospectionApp() {
  return createDaemonApp({
    registry: new SessionRegistry(),
    readHealth: () => ({
      version: CONTRACT_VERSION,
      vault: '/parity-fixture',
      uptimeSeconds: 0,
      sessionCount: 0,
    }),
    onShutdown: () => {},
  })
}

export function getMountedDaemonRoutes(): readonly Omit<
  NormalizedDaemonRoute,
  'id'
>[] {
  return createParityIntrospectionApp().routes.map((route) => ({
    method: toDaemonRouteMethod(route.method),
    path: route.path,
  }))
}

export function normalizeDaemonRoute(
  route: Omit<NormalizedDaemonRoute, 'id'>,
): NormalizedDaemonRoute | null {
  const signature = `${route.method} ${route.path}`
  if (isExemptRouteSignature(signature)) {
    return null
  }

  const id = DAEMON_ROUTE_ID_BY_SIGNATURE[
    signature as keyof typeof DAEMON_ROUTE_ID_BY_SIGNATURE
  ]
  if (!id) {
    throw new Error(
      `Unexpected daemon route without BF-232 parity mapping: ${signature}`,
    )
  }

  return { ...route, id }
}

export function getDaemonRouteParityRegistry(): readonly NormalizedDaemonRoute[] {
  return getMountedDaemonRoutes().flatMap((route) => {
    const normalized = normalizeDaemonRoute(route)
    return normalized ? [normalized] : []
  })
}
