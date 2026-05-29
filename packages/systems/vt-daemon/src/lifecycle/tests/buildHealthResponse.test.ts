// Pure-function tests for the /health projector (BF-372).
//
// Per CLAUDE.md: input → output assertions, no internal mocks, no
// HTTP-stack involvement. The projector is a value function; this
// suite exercises it as such.

import {describe, expect, it} from 'vitest'

import {buildVtDaemonHealthResponse} from '../buildHealthResponse.ts'
import type {VtDaemonHealthOwner} from '../../contract.ts'
import {VtDaemonHealthResponseSchema} from '../../contract.ts'

const sampleOwner: VtDaemonHealthOwner = {
    schemaVersion: 1,
    canonicalProject: '/abs/project',
    pid: 12345,
    ppid: 1,
    port: 51999,
    ownerNonce: 'abc123',
    contractVersion: '0.1.0',
}

describe('buildVtDaemonHealthResponse', (): void => {
    it('projects inputs into a wire-shape that parses against the VTD schema', (): void => {
        const out = buildVtDaemonHealthResponse({
            contractVersion: '0.1.0',
            startMs: 1_000,
            nowMs: 3_500,
            owner: null,
            canonicalProject: '/abs/project',
        })
        expect(out).toEqual({
            version: '0.1.0',
            project: '/abs/project',
            uptimeSeconds: 2,
            daemonKind: 'vtd',
            owner: null,
        })
        // Round-trip through the wire schema — guards against a future
        // shape drift where the projector and schema disagree.
        expect(VtDaemonHealthResponseSchema.safeParse(out).success).toBe(true)
    })

    it('passes the owner block through unchanged when present', (): void => {
        const out = buildVtDaemonHealthResponse({
            contractVersion: '0.1.0',
            startMs: 0,
            nowMs: 60_000,
            owner: sampleOwner,
            canonicalProject: sampleOwner.canonicalProject,
        })
        expect(out.owner).toEqual(sampleOwner)
        expect(out.uptimeSeconds).toBe(60)
        expect(out.daemonKind).toBe('vtd')
        // The schema constrains `daemonKind` to the literal 'vtd' — a
        // future accidental retag would fail safeParse.
        expect(VtDaemonHealthResponseSchema.safeParse(out).success).toBe(true)
    })

    it('emits project: null when canonicalProject is null (projectless startup)', (): void => {
        const out = buildVtDaemonHealthResponse({
            contractVersion: '0.1.0',
            startMs: 5_000,
            nowMs: 5_750,
            owner: null,
            canonicalProject: null,
        })
        expect(out.project).toBeNull()
        expect(out.uptimeSeconds).toBe(0)
        expect(VtDaemonHealthResponseSchema.safeParse(out).success).toBe(true)
    })

    it('floors uptime to whole seconds (graphd parity — no rounding)', (): void => {
        const out = buildVtDaemonHealthResponse({
            contractVersion: '0.1.0',
            startMs: 0,
            nowMs: 2_999,
            owner: null,
            canonicalProject: '/x',
        })
        // 2.999s wall clock should report 2s, not 3 — graphd's projector
        // uses Math.floor, and a probe round-tripping uptimeSeconds must
        // see a monotone non-decreasing series even when called rapidly.
        expect(out.uptimeSeconds).toBe(2)
    })
})
