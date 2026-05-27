/**
 * HTTP probe of a daemon's `/health` endpoint, projected into the
 * {@link HealthProbeResult} shape consumed by {@link decideOwnerAction}.
 *
 * The `/health` response carries an `owner: ... | null` field. The probe
 * surfaces it as one of three observable states:
 * - `unreachable`: the socket refused, timed out, or the response failed
 *   to parse against the daemon-kind's schema (graphd → HealthResponse,
 *   vtd → VtDaemonHealthResponse).
 * - `mismatch`: the daemon answered with `owner === null` (no owner
 *   claim yet — happens during the vaultless startup window or on
 *   legacy paths). The pure decision treats this as "not this vault's
 *   owner".
 * - `verified`: the daemon answered with a complete owner block.
 *
 * The probe never compares against the on-disk record itself — the
 * policy comparison stays inside {@link decideOwnerAction} so this
 * adapter has a single concern. BF-372 generalised the probe over
 * {@link DaemonKind} so the same code path serves vt-graphd and
 * vt-daemon; the only difference is which schema validates the body.
 * Caller asking for `'vtd'` will reject a graphd response (no
 * `daemonKind` discriminator) and vice-versa.
 */

import {
  HealthResponseSchema,
  VtDaemonHealthResponseSchema,
  type DaemonKind,
  type HealthOwner,
  type VtDaemonHealthOwner,
} from '@vt/graph-db-protocol'
import type { HealthProbeResult } from './ownerDecision.ts'

export type ProbeHealthOptions = {
  readonly timeoutMs?: number
  /** Required; pass the global `fetch` from the shell boundary. The
   * transitive-purity gate flags any reference to the `fetch` global
   * inside a function body. */
  readonly fetchImpl: typeof fetch
  /**
   * Which daemon-kind's wire schema to validate against. Defaults to
   * `'graphd'` so all pre-BF-372 callers (spawnCoordinator.ts) continue
   * to work without modification. BF-373's vt-daemon ensure path
   * supplies `'vtd'` so the probe rejects responses that lack the
   * `daemonKind: 'vtd'` discriminator.
   */
  readonly daemonKind?: DaemonKind
}

const DEFAULT_TIMEOUT_MS = 1500

/**
 * Parse the response body against the appropriate daemon-kind schema,
 * returning ONLY the `owner` projection — the four fields used by every
 * downstream decision (canonicalVault, ownerNonce, pid, port). Returns
 * `undefined` on parse failure (schema mismatch, body is not the expected
 * daemon's wire shape).
 *
 * `HealthOwner` and `VtDaemonHealthOwner` are structurally identical for
 * the fields the probe cares about; the projection collapses them.
 */
function parseOwnerProjection(
  body: unknown,
  daemonKind: DaemonKind,
): HealthOwner | VtDaemonHealthOwner | null | undefined {
  if (daemonKind === 'vtd') {
    const parsed = VtDaemonHealthResponseSchema.safeParse(body)
    return parsed.success ? parsed.data.owner : undefined
  }
  const parsed = HealthResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.owner : undefined
}

export async function probeOwnerHealth(
  port: number,
  options: ProbeHealthOptions,
): Promise<HealthProbeResult> {
  const fetchImpl = options.fetchImpl
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const daemonKind: DaemonKind = options.daemonKind ?? 'graphd'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    })
    if (!response.ok) return { kind: 'unreachable' }
    const body: unknown = await response.json()
    const owner = parseOwnerProjection(body, daemonKind)
    if (owner === undefined) return { kind: 'unreachable' }
    if (owner === null) {
      return {
        kind: 'mismatch',
        observedCanonicalVault: null,
        observedOwnerNonce: null,
      }
    }
    return {
      kind: 'verified',
      canonicalVault: owner.canonicalVault,
      ownerNonce: owner.ownerNonce,
      pid: owner.pid,
      port: owner.port,
    }
  } catch {
    return { kind: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
