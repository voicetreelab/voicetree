/**
 * Black-box test for the martin-distance subgraph measure.
 *
 * Uses on-disk tempdir fixtures + parseSubgraph + includeInbound:true
 * because Ca needs inbound edges.
 *
 * Asserted shapes:
 *   - Pure ports community (only interfaces/types, low Ce, high Ca):
 *     A≈1, I≈0, D ≈ 0  → stable abstraction.
 *   - Pure shell community (only impls, high Ce, low Ca):
 *     A=0, I≈1, D ≈ 0  → concrete adapter.
 *   - utils/ zone-of-pain (concrete, high Ca, low Ce):
 *     A=0, I≈0, D ≈ 1  → fail.
 */
import {afterAll, describe, expect, it} from 'vitest'
import {parseSubgraph} from '../../../../_shared/graph/parse-subgraph.ts'
import {
    classifyDecls,
    martinDistanceMeasure,
    MARTIN_DISTANCE_FAIL,
} from './martin-distance.ts'
import {buildTempRepo, type Fixture} from '../test-support/tempdir-fixture.ts'

const cleanups: Fixture[] = []
afterAll(async () => {
    await Promise.all(cleanups.map(f => f.cleanup()))
})

describe('classifyDecls (pure)', () => {
    it('interfaces and types are abstract', () => {
        const text = [
            'export interface Port { fetch(id: string): Promise<number> }',
            'export type Result<T> = { ok: true; value: T } | { ok: false; error: string }',
        ].join('\n')
        const {abstract, concrete} = classifyDecls('x.ts', text)
        expect(abstract).toBe(2)
        expect(concrete).toBe(0)
    })

    it('classes, functions, consts are concrete', () => {
        const text = [
            'export class Service {}',
            'export function go(): number { return 1 }',
            'export const x = 1',
            'export const fn = () => 2',
        ].join('\n')
        const {abstract, concrete} = classifyDecls('x.ts', text)
        expect(abstract).toBe(0)
        expect(concrete).toBe(4)
    })

    it('abstract class counts as abstract', () => {
        const text = 'export abstract class Base { abstract go(): void }'
        const {abstract, concrete} = classifyDecls('x.ts', text)
        expect(abstract).toBe(1)
        expect(concrete).toBe(0)
    })
})

describe('martin-distance (subgraph measure)', () => {
    it('pure-ports community (high A, low I) → D ≈ 0, healthy', async () => {
        // ports community exports only interfaces; many concrete files
        // (shell) import it but nothing in ports imports anything.
        const fixture = await buildTempRepo([
            {pkg: 'pkg-mart', relToSrc: 'ports/p1.ts', contents: 'export interface P1 { x: number }\n'},
            {pkg: 'pkg-mart', relToSrc: 'ports/p2.ts', contents: 'export interface P2 { y: number }\n'},
            {pkg: 'pkg-mart', relToSrc: 'shell/s1.ts', contents: 'import type {P1} from \'../ports/p1.ts\'\nexport const a: P1 = {x: 1}\n'},
            {pkg: 'pkg-mart', relToSrc: 'shell/s2.ts', contents: 'import type {P2} from \'../ports/p2.ts\'\nexport const b: P2 = {y: 2}\n'},
        ])
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {
            repoRoot: fixture.repoRoot,
            depth: 1,
            includeInbound: true,
        })
        const result = await martinDistanceMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})
        const portsD = result.perCommunity['pkg-mart/ports']
        // A=1 (2 interfaces / 2 decls), I should be 0 (Ce=0, Ca=2),
        // so D = |1 + 0 − 1| = 0.
        expect(portsD).toBeLessThan(0.1)
    })

    it('utils-bucket community (concrete, high Ca, low Ce) → D ≈ 1, fails', async () => {
        const fixture = await buildTempRepo([
            // utils: 100% concrete, lots of inbound, nothing outbound.
            {pkg: 'pkg-bad', relToSrc: 'utils/format.ts', contents: 'export function format(x: number): string { return String(x) }\n'},
            {pkg: 'pkg-bad', relToSrc: 'utils/clamp.ts', contents: 'export function clamp(n: number): number { return Math.max(0, n) }\n'},
            // consumers in OTHER communities so the partition has structure.
            {pkg: 'pkg-bad', relToSrc: 'web/handler.ts', contents: 'import {format} from \'../utils/format.ts\'\nexport const h = (n: number) => format(n)\n'},
            {pkg: 'pkg-bad', relToSrc: 'api/route.ts', contents: 'import {clamp} from \'../utils/clamp.ts\'\nexport const r = (n: number) => clamp(n)\n'},
        ])
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {
            repoRoot: fixture.repoRoot,
            depth: 1,
            includeInbound: true,
        })
        const result = await martinDistanceMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})
        const utilsD = result.perCommunity['pkg-bad/utils']
        // A=0 (both concrete), I=0 (Ce=0 outbound, Ca>0 inbound). D = |0 + 0 − 1| = 1.
        expect(utilsD).toBeGreaterThanOrEqual(MARTIN_DISTANCE_FAIL)
        const fail = result.violations.find(v => v.community === 'pkg-bad/utils')!
        expect(fail.severity).toBe('fail')
        expect(fail.message).toContain('zone of pain')
    })

    it('pure-shell community (concrete, low Ca, high Ce) → D ≈ 0, healthy', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'pkg-sh', relToSrc: 'ports/p.ts', contents: 'export interface P { do(): void }\n'},
            {pkg: 'pkg-sh', relToSrc: 'core/c.ts', contents: 'export function go(): number { return 1 }\n'},
            // shell: nothing imports it; it imports ports + core.
            {pkg: 'pkg-sh', relToSrc: 'shell/main.ts', contents: [
                'import type {P} from \'../ports/p.ts\'',
                'import {go} from \'../core/c.ts\'',
                'export const adapter: P = { do() { go() } }',
            ].join('\n') + '\n'},
        ])
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {
            repoRoot: fixture.repoRoot,
            depth: 1,
            includeInbound: true,
        })
        const result = await martinDistanceMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})
        const shellD = result.perCommunity['pkg-sh/shell']
        // A=0, I=1 (Ce=2 outbound, Ca=0). D = |0 + 1 − 1| = 0.
        expect(shellD).toBeLessThan(0.1)
    })
})
