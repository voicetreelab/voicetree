/**
 * vt-daemon contract surface.
 *
 * The standalone VTD controller (BF-370+) evolves its protocol independently
 * from vt-graphd's, so it owns a separate {@link VTD_CONTRACT_VERSION}. Do NOT
 * import graph-db-protocol's `CONTRACT_VERSION` here — the two constants are
 * deliberately distinct and must not converge by accident.
 *
 * This file holds only the surface the BF-370 owner lifecycle needs (the
 * version constant and the owner-identity projection type used by the handle's
 * `health()` getter). The full `/health` response shape, request/response zod
 * schemas, and the `buildHealthResponse` projector are owned by BF-372 and
 * will be added in a later commit.
 */

export const VTD_CONTRACT_VERSION = '0.1.0'

/**
 * Owner-identifying projection of a VtDaemonOwnerRecord, surfaced by the
 * future `/health` route (BF-372). Returned by `VtDaemonOwnerHandle.health()`
 * once the daemon has bound a port; the handle returns `null` while the
 * claim exists but no port is bound yet.
 *
 * The shape mirrors `HealthOwner` from `@vt/graph-db-protocol` (graphd's
 * equivalent projection): both projections expose the same seven owner-
 * identity fields so an HTTP probe can verify "is this the daemon I am
 * allowed to talk to?". Defined here (not re-exported from the protocol
 * package) because VTD's contract evolves independently — if VTD adds a new
 * identity field tomorrow, graphd's projection must not silently inherit it.
 */
export type VtDaemonHealthOwner = {
    readonly schemaVersion: 1
    readonly canonicalVault: string
    readonly pid: number
    readonly ppid: number
    readonly port: number
    readonly ownerNonce: string
    readonly contractVersion: string
}
