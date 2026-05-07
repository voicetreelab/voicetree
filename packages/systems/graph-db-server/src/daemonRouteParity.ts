import { CONTRACT_VERSION } from './contract.ts'
import { createDaemonApp } from './daemonApp.ts'
import { SessionRegistry } from './session/registry.ts'

const DAEMON_ROUTE_IDS = [
  'context-nodes.create',
  'context-nodes.create-from-question',
  'context-nodes.create-from-selection',
  'context-nodes.preview-contained',
  'context-nodes.update-contained-ids',
  'context-nodes.unseen-nearby',
  'graph.delta',
  'graph.delete-node',
  'graph.positions',
  'graph.read',
  'graph.redo',
  'graph.reload',
  'graph.undo',
  'graph.view',
  'search.build-index',
  'search.file',
  'search.nodes',
  'session.create',
  'session.delete',
  'session.events',
  'session.show',
  'vault.add-read-path',
  'vault.load-and-merge',
  'vault.remove-read-path',
  'vault.set-write-path',
  'vault.show',
  'view.collapse',
  'view.expand',
  'view.layout',
  'view.selection',
  'view.show',
  'watch.project-root-read',
  'watch.project-root-write',
  'watch.status',
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
  'GET /context-nodes/:encodedNodeId/preview-contained':
    'context-nodes.preview-contained',
  'GET /context-nodes/:encodedNodeId/unseen-nearby':
    'context-nodes.unseen-nearby',
  'PATCH /context-nodes/:encodedNodeId/contained-ids':
    'context-nodes.update-contained-ids',
  'DELETE /graph/node/:encodedNodeId': 'graph.delete-node',
  'DELETE /sessions/:sessionId': 'session.delete',
  'DELETE /sessions/:sessionId/collapse/:folderId': 'view.expand',
  'DELETE /vault/read-paths/:encodedPath': 'vault.remove-read-path',
  'GET /graph': 'graph.read',
  'GET /search': 'search.nodes',
  'GET /search/file': 'search.file',
  'GET /sessions/:sessionId': 'session.show',
  'GET /sessions/:sessionId/events': 'session.events',
  'GET /sessions/:sessionId/state': 'view.show',
  'GET /sessions/:sessionId/view': 'graph.view',
  'GET /vault': 'vault.show',
  'GET /watch/project-root': 'watch.project-root-read',
  'GET /watch/status': 'watch.status',
  'POST /context-nodes': 'context-nodes.create',
  'POST /context-nodes/from-question': 'context-nodes.create-from-question',
  'POST /context-nodes/from-selection': 'context-nodes.create-from-selection',
  'POST /graph/reload': 'graph.reload',
  'POST /graph/redo': 'graph.redo',
  'POST /graph/delta': 'graph.delta',
  'POST /graph/undo': 'graph.undo',
  'POST /search/build-index': 'search.build-index',
  'POST /sessions': 'session.create',
  'POST /sessions/:sessionId/collapse/:folderId': 'view.collapse',
  'POST /sessions/:sessionId/selection': 'view.selection',
  'POST /vault/load-and-merge': 'vault.load-and-merge',
  'POST /vault/read-paths': 'vault.add-read-path',
  'PUT /graph/positions': 'graph.positions',
  'PUT /sessions/:sessionId/layout': 'view.layout',
  'PUT /vault/write-path': 'vault.set-write-path',
  'PUT /watch/project-root': 'watch.project-root-write',
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
] as const satisfies readonly DaemonRouteExemption[]

const EXEMPT_SIGNATURES = new Set(
  DAEMON_ROUTE_PARITY_EXEMPTIONS.map(
    (route): string => `${route.method} ${route.path}`,
  ),
)

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
  if (EXEMPT_SIGNATURES.has(signature)) {
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
