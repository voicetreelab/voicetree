// Black-box tests for the name-uniqueness deep function. No mocks of
// internal helpers; tests only construct synthetic inputs and assert on
// the violations array shape.
//
// The deep function exposes ONE public type alongside the function;
// nested record types (DeclaredName / NameIndex / AllowlistConfig /
// ImportGraph) are derived inline from `NameUniquenessInput` indexed
// access so we don't widen the community's public surface.

import {describe, expect, it} from 'vitest'

import {findNameUniquenessViolations, type NameUniquenessInput} from './find-violations.ts'

type DeclaredName = NameUniquenessInput['scope'][number]
type NameIndex = NameUniquenessInput['index']
type AllowlistConfig = NameUniquenessInput['allowlist']
type ImportGraph = NameUniquenessInput['importGraph']

const EMPTY_GRAPH: ImportGraph = {
    knownFiles: new Set(),
    canReach: () => false,
}

const ALLOWLIST: AllowlistConfig = {
    metricVersion: 1,
    universal: new Set(['get', 'value', 'check']),
    projectConventions: new Set(['workflow']),
}

function decl(name: string, filePath: string, kind: DeclaredName['kind'] = 'file'): DeclaredName {
    return {name, filePath, kind}
}

function buildIndex(declarations: readonly DeclaredName[]): NameIndex {
    const byFilePath = new Map<string, DeclaredName[]>()
    for (const d of declarations) {
        const list = byFilePath.get(d.filePath) ?? []
        list.push(d)
        byFilePath.set(d.filePath, list)
    }
    return {declarations, byFilePath}
}

describe('findNameUniquenessViolations', () => {
    it('exempts a single-token cluster when the token is in projectConventions', () => {
        const declarations = [
            decl('workflow', '/repo/a/workflow.ts'),
            decl('workflow', '/repo/b/workflow.ts'),
            decl('workflow', '/repo/c/workflow.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('exempts an all-generic multi-token cluster (getValue / setValue pattern)', () => {
        const declarations = [
            decl('getValue', '/repo/a/get-value.ts', 'export-function'),
            decl('getValue', '/repo/b/another.ts', 'export-function'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('flags a single non-generic token cluster (vault) — every scope member becomes a violation', () => {
        const declarations = [
            decl('vault', '/repo/a/vault.ts'),
            decl('vault', '/repo/b/vault.ts'),
            decl('vault', '/repo/c/vault.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(3)
        expect(violations.map(v => v.declaration.filePath).sort()).toEqual([
            '/repo/a/vault.ts',
            '/repo/b/vault.ts',
            '/repo/c/vault.ts',
        ])
        for (const v of violations) {
            expect(v.collidingMembers.length).toBeGreaterThanOrEqual(1)
            expect(v.collidingMembers.every(m => m.filePath !== v.declaration.filePath)).toBe(true)
        }
    })

    it('flags a multi-word cluster when at least one token is domain (apply + positions)', () => {
        const declarations = [
            decl('applyPositions', '/repo/a/apply-positions.ts', 'export-function'),
            decl('applyPositions', '/repo/b/apply-positions.ts', 'export-function'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(2)
    })

    it('drops same-file members — a file declaring basename + function + type collapses to one conceptual decl', () => {
        const declarations = [
            decl('applyGraphDeltaToGraph', '/repo/apply-graph-delta-to-graph.ts'),
            decl('applyGraphDeltaToGraph', '/repo/apply-graph-delta-to-graph.ts', 'export-function'),
            decl('applyGraphDeltaToGraph', '/repo/apply-graph-delta-to-graph.ts', 'export-type'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('drops test-file members from the cluster (foo.ts + foo.test.ts → cluster of 1)', () => {
        const declarations = [
            decl('vault', '/repo/a/vault.ts'),
            decl('vault', '/repo/a/vault.test.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('exempts a cluster whose members are reachable within K=3 hops in the import graph', () => {
        const declarations = [
            decl('applyDelta', '/repo/a.ts', 'export-function'),
            decl('applyDelta', '/repo/b.ts', 'export-function'),
            decl('applyDelta', '/repo/c.ts', 'export-function'),
        ]
        const knownFiles = new Set(['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'])
        const importGraph: ImportGraph = {
            knownFiles,
            canReach: (a, b, maxHops) => {
                if (a === b) return true
                if (!knownFiles.has(a) || !knownFiles.has(b)) return false
                if (maxHops >= 1) {
                    if ((a === '/repo/a.ts' && b === '/repo/b.ts')
                        || (a === '/repo/b.ts' && b === '/repo/a.ts')
                        || (a === '/repo/b.ts' && b === '/repo/c.ts')
                        || (a === '/repo/c.ts' && b === '/repo/b.ts')) return true
                }
                if (maxHops >= 2) {
                    if ((a === '/repo/a.ts' && b === '/repo/c.ts')
                        || (a === '/repo/c.ts' && b === '/repo/a.ts')) return true
                }
                return false
            },
        }
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph,
        })
        expect(violations).toHaveLength(0)
    })

    it('diff-scoping: a legacy cluster of size 5 with empty scope produces zero violations', () => {
        const allDeclarations = [
            decl('vault', '/repo/a/vault.ts'),
            decl('vault', '/repo/b/vault.ts'),
            decl('vault', '/repo/c/vault.ts'),
            decl('vault', '/repo/d/vault.ts'),
            decl('vault', '/repo/e/vault.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: [],
            index: buildIndex(allDeclarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('diff-scoping: only the single in-scope member of a 5-member cluster is flagged', () => {
        const allDeclarations = [
            decl('vault', '/repo/a/vault.ts'),
            decl('vault', '/repo/b/vault.ts'),
            decl('vault', '/repo/c/vault.ts'),
            decl('vault', '/repo/d/vault.ts'),
            decl('vault', '/repo/e/vault.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: [allDeclarations[0]],
            index: buildIndex(allDeclarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(1)
        expect(violations[0].declaration.filePath).toBe('/repo/a/vault.ts')
        expect(violations[0].collidingMembers).toHaveLength(4)
    })

    it('declarations whose significant token set is empty are not clustered (basename "index.ts" alone)', () => {
        const declarations = [
            decl('index', '/repo/a/index.ts'),
            decl('index', '/repo/b/index.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })

    it('scope decl absent from the index still gets clustered (brand-new file joins existing cluster)', () => {
        const indexed = [
            decl('vault', '/repo/a/vault.ts'),
            decl('vault', '/repo/b/vault.ts'),
        ]
        const newDecl = decl('vault', '/repo/scratch/_trial-vault.ts')
        const violations = findNameUniquenessViolations({
            scope: [newDecl],
            index: buildIndex(indexed),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(1)
        expect(violations[0].declaration.filePath).toBe('/repo/scratch/_trial-vault.ts')
        expect(violations[0].collidingMembers).toHaveLength(2)
    })

    it('strips test-file suffix tokens before tokenisation so foo.test.ts does not register a "test" token', () => {
        const declarations = [
            decl('vault.test', '/repo/a/vault.test.ts'),
            decl('vault', '/repo/a/vault.ts'),
        ]
        const violations = findNameUniquenessViolations({
            scope: declarations,
            index: buildIndex(declarations),
            allowlist: ALLOWLIST,
            importGraph: EMPTY_GRAPH,
        })
        expect(violations).toHaveLength(0)
    })
})
