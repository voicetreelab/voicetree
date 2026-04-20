import { CONTRACT_VERSION } from './contract.ts'
import { createDaemonApp } from './daemonApp.ts'
import { SessionRegistry } from './session/registry.ts'

const DAEMON_ROUTE_IDS = [
  'graph.read',
  'session.create',
  'session.delete',
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

export type DaemonRouteMethod = 'DELETE' | 'GET' | 'POST' | 'PUT'

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
  'DELETE /sessions/:sessionId': 'session.delete',
  'DELETE /sessions/:sessionId/collapse/:folderId': 'view.expand',
  'DELETE /vault/read-paths/:encodedPath': 'vault.remove-read-path',
  'GET /graph': 'graph.read',
  'GET /sessions/:sessionId': 'session.show',
  'GET /sessions/:sessionId/state': 'view.show',
  'GET /vault': 'vault.show',
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
