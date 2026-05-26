/**
 * HTTP probe of `vt-graphd`'s `/health` endpoint, projected into the
 * {@link HealthProbeResult} shape consumed by {@link decideOwnerAction}.
 *
 * The daemon's `/health` response (HealthResponseSchema in
 * `@vt/graph-db-protocol`) carries an `owner: HealthOwner | null` field.
 * The probe surfaces it as one of three observable states:
 * - `unreachable`: the socket refused, timed out, or the response failed
 *   to parse as a HealthResponse.
 * - `mismatch`: the daemon answered with `owner === null` (no owner claim
 *   yet — happens during the vaultless startup window or on legacy paths).
 *   The pure decision treats this as "not this vault's owner".
 * - `verified`: the daemon answered with a complete `HealthOwner` block.
 *
 * The probe never compares against the on-disk record itself — the policy
 * comparison stays inside {@link decideOwnerAction} so this adapter has a
 * single concern.
 */

import { HealthResponseSchema } from '@vt/graph-db-protocol'
import type { HealthProbeResult } from '../ownership/ownerDecision.ts'

export type ProbeHealthOptions = {
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 1500

export async function probeOwnerHealth(
  port: number,
  options: ProbeHealthOptions = {},
): Promise<HealthProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    })
    if (!response.ok) return { kind: 'unreachable' }
    const body: unknown = await response.json()
    const parsed = HealthResponseSchema.safeParse(body)
    if (!parsed.success) return { kind: 'unreachable' }
    const owner = parsed.data.owner
    if (owner === null) {
      return {
        kind: 'mismatch',
        observedCanonicalProjectRoot: null,
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
