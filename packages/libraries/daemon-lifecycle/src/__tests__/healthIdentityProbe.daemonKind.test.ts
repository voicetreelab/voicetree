// Probe-generalisation tests for BF-372: probeOwnerHealth must select
// the right wire schema for the asked-for daemon kind, and must REJECT
// (return `unreachable`) when the response shape belongs to the other
// daemon's protocol.
//
// Per CLAUDE.md: black-box. We do not mock the probe's internal fetch
// path — we inject the fetch implementation as documented in
// ProbeHealthOptions and assert on the observable return value.

import { describe, expect, it } from 'vitest'

import { probeOwnerHealth } from '../healthIdentityProbe.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Verified VTD wire body. Matches the BF-372 VtDaemonHealthResponseSchema
// in @vt/graph-db-protocol — owner present, daemonKind: 'vtd'.
const vtdBody = {
  version: '0.1.0',
  vault: '/v',
  uptimeSeconds: 7,
  daemonKind: 'vtd' as const,
  owner: {
    schemaVersion: 1 as const,
    canonicalVault: '/v',
    pid: 12345,
    ppid: 1,
    port: 51999,
    ownerNonce: 'vtd-nonce',
    contractVersion: '0.1.0',
  },
}

// Verified graphd wire body. Matches HealthResponseSchema — owner present,
// sessionCount present, NO daemonKind discriminator.
const graphdBody = {
  version: '0.2.0',
  vault: '/v',
  uptimeSeconds: 3,
  sessionCount: 0,
  owner: {
    schemaVersion: 1 as const,
    canonicalVault: '/v',
    pid: 22222,
    ppid: 1,
    port: 52000,
    ownerNonce: 'graphd-nonce',
    contractVersion: '0.2.0',
  },
}

describe('probeOwnerHealth — daemonKind selection (BF-372)', (): void => {
  it('verifies a VTD response when caller asks for daemonKind: vtd', async (): Promise<void> => {
    const probe = await probeOwnerHealth(0, {
      daemonKind: 'vtd',
      fetchImpl: async () => jsonResponse(vtdBody),
    })
    expect(probe.kind).toBe('verified')
    if (probe.kind !== 'verified') return // narrow
    expect(probe.canonicalVault).toBe('/v')
    expect(probe.ownerNonce).toBe('vtd-nonce')
    expect(probe.port).toBe(51999)
    expect(probe.pid).toBe(12345)
  })

  it('returns `unreachable` when caller asks for vtd but daemon serves graphd shape (missing daemonKind discriminator)', async (): Promise<void> => {
    const probe = await probeOwnerHealth(0, {
      daemonKind: 'vtd',
      fetchImpl: async () => jsonResponse(graphdBody),
    })
    // The VTD schema requires `daemonKind: 'vtd'`; a graphd body has no
    // such field. Schema mismatch must collapse to `unreachable` so the
    // ensure path does not treat the wrong-kind daemon as a valid owner.
    expect(probe.kind).toBe('unreachable')
  })

  it('REGRESSION: default daemonKind (omitted) still validates graphd bodies (pre-BF-372 callers untouched)', async (): Promise<void> => {
    const probe = await probeOwnerHealth(0, {
      fetchImpl: async () => jsonResponse(graphdBody),
    })
    expect(probe.kind).toBe('verified')
    if (probe.kind !== 'verified') return
    expect(probe.canonicalVault).toBe('/v')
    expect(probe.ownerNonce).toBe('graphd-nonce')
  })

  it('REGRESSION: default daemonKind rejects a vtd-shaped body (graphd schema requires sessionCount)', async (): Promise<void> => {
    // Symmetric guard: a graphd probe must not silently accept the
    // sibling daemon's response just because the owner block overlaps.
    const probe = await probeOwnerHealth(0, {
      fetchImpl: async () => jsonResponse(vtdBody),
    })
    expect(probe.kind).toBe('unreachable')
  })

  it('returns `mismatch` when the body parses but owner is null (vaultless startup window)', async (): Promise<void> => {
    const probe = await probeOwnerHealth(0, {
      daemonKind: 'vtd',
      fetchImpl: async () => jsonResponse({ ...vtdBody, owner: null }),
    })
    expect(probe.kind).toBe('mismatch')
    if (probe.kind !== 'mismatch') return
    expect(probe.observedCanonicalVault).toBeNull()
    expect(probe.observedOwnerNonce).toBeNull()
  })

  it('returns `unreachable` on a non-OK HTTP response (503 from a not-wired /health)', async (): Promise<void> => {
    const probe = await probeOwnerHealth(0, {
      daemonKind: 'vtd',
      fetchImpl: async () => jsonResponse({ error: 'health probe not wired' }, 503),
    })
    expect(probe.kind).toBe('unreachable')
  })
})
