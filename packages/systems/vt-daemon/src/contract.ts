/**
 * vt-daemon contract surface.
 *
 * The standalone VTD controller (BF-370+) evolves its protocol independently
 * from vt-graphd's, so it owns a separate {@link VTD_CONTRACT_VERSION}. Do NOT
 * import graph-db-protocol's `CONTRACT_VERSION` here — the two constants are
 * deliberately distinct and must not converge by accident.
 *
 * Wire shapes
 * -----------
 * The zod schemas for the `/health` response (BF-372) live in
 * `@vt/graph-db-protocol` alongside graphd's `HealthResponseSchema` — both
 * shapes are protocol-level wire contracts and co-locating them keeps
 * `@vt/daemon-lifecycle` (which probes both daemons) free of a cycle back
 * into `@vt/vt-daemon`. We re-export the shapes from here so vt-daemon
 * consumers see one cohesive surface; the types are inferred from those
 * schemas so the wire shape and the in-code type cannot drift.
 */

export {
  VtDaemonHealthOwnerSchema,
  VtDaemonHealthResponseSchema,
  type VtDaemonHealthOwner,
  type VtDaemonHealthResponse,
} from '@vt/graph-db-protocol'

export const VTD_CONTRACT_VERSION = '0.1.0'
