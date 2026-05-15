import {
  DAEMON_ROUTE_SPECS,
  isCliBackedDaemonRouteSpec,
  isExemptDaemonRouteSpec,
  type DaemonRouteId,
  type DaemonRouteMethod,
  type DaemonRouteSpec,
} from './routeSpecs.ts'

export type { DaemonRouteId, DaemonRouteMethod }

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

export const DAEMON_ROUTE_PARITY_EXEMPTIONS = DAEMON_ROUTE_SPECS
  .flatMap((route): DaemonRouteExemption[] =>
    isExemptDaemonRouteSpec(route)
      ? [{
          method: route.method,
          path: route.path,
          reason: route.exemptionReason,
        }]
      : [],
  )

function isExemptRouteSignature(signature: string): boolean {
  return DAEMON_ROUTE_PARITY_EXEMPTIONS.some(
    route => signature === `${route.method} ${route.path}`,
  )
}

function specForSignature(signature: string): DaemonRouteSpec | undefined {
  return DAEMON_ROUTE_SPECS.find(
    route => signature === `${route.method} ${route.path}`,
  )
}

export function getMountedDaemonRoutes(): readonly Omit<
  NormalizedDaemonRoute,
  'id'
>[] {
  return DAEMON_ROUTE_SPECS.map((route) => ({
    method: route.method,
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

  const spec = specForSignature(signature)
  if (!spec || !isCliBackedDaemonRouteSpec(spec)) {
    throw new Error(
      `Unexpected daemon route without BF-232 parity mapping: ${signature}`,
    )
  }

  return { ...route, id: spec.id }
}

export function getDaemonRouteParityRegistry(): readonly NormalizedDaemonRoute[] {
  return getMountedDaemonRoutes().flatMap((route) => {
    const normalized = normalizeDaemonRoute(route)
    return normalized ? [normalized] : []
  })
}
