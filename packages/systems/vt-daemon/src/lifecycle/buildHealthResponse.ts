/**
 * Pure projector for the vt-daemon (VTD) `/health` response (BF-372).
 *
 * Mirrors graphd's `buildHealthResponse` in
 * `packages/systems/graph-db-server/src/daemon/daemonTypes.ts:94-109` —
 * narrow, deterministic, no I/O, no clock. The HTTP route handler
 * invokes this on every request to project current owner state into
 * the wire shape; the per-request invocation keeps the response live
 * (it sees a fresh `nowMs` and a fresh `owner` snapshot from
 * `VtDaemonOwnerHandle.health()`).
 *
 * Black-box testable: feed inputs, assert on outputs. No internal mocks.
 */

import type { VtDaemonHealthOwner, VtDaemonHealthResponse } from '../contract.ts'

export interface BuildHealthInput {
    readonly contractVersion: string
    readonly startMs: number
    readonly nowMs: number
    /**
     * Owner identity snapshot. `null` during the projectless startup window
     * between `claimVtDaemonOwner` and `ownerHandle.bindPort(port)` —
     * BF-370's handle returns `null` until the loopback port is bound.
     * The probe (BF-369 generalised in BF-372) treats `owner === null` as
     * "not this project's owner yet, retry"; pass through faithfully here.
     */
    readonly owner: VtDaemonHealthOwner | null
    /**
     * Canonical project path the daemon is serving. `null` only in the
     * (very short-lived) projectless startup case; graphd's response carries
     * the same nullable shape for symmetry.
     */
    readonly canonicalProject: string | null
}

export function buildVtDaemonHealthResponse(
    input: BuildHealthInput,
): VtDaemonHealthResponse {
    return {
        version: input.contractVersion,
        project: input.canonicalProject,
        uptimeSeconds: Math.floor((input.nowMs - input.startMs) / 1000),
        daemonKind: 'vtd',
        owner: input.owner,
    }
}
