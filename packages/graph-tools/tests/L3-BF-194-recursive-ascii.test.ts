import {describe, expect, it} from 'vitest'
import {buildRecursiveAscii} from '../scripts/L3-BF-194-recursive-ascii'
import {computeNavigationStats, parseRecursiveAscii, scoreRecursiveAscii} from '../scripts/L3-BF-194-recursive-parser'
import type {JsonState} from '../scripts/L3-BF-192-tree-cover-render'

describe('L3-BF-194 recursive ASCII', () => {
    it('extracts dense subtrees into fragments and roundtrips the edge set', () => {
        const vaultRoot: string = '/tmp/bf194-fixture'
        const state: JsonState = {
            graph: {
                nodes: {
                    [`${vaultRoot}/root.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/root.md`,
                        contentWithoutYamlOrLinks: '# Root',
                        outgoingEdges: [{targetId: `${vaultRoot}/atlas/atlas-index.md`}],
                    },
                    [`${vaultRoot}/atlas/atlas-index.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/atlas/atlas-index.md`,
                        contentWithoutYamlOrLinks: '# Atlas Index',
                        outgoingEdges: [
                            {targetId: `${vaultRoot}/atlas/sector-a/a1.md`},
                            {targetId: `${vaultRoot}/atlas/sector-b/b1.md`},
                        ],
                    },
                    [`${vaultRoot}/atlas/sector-a/a1.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/atlas/sector-a/a1.md`,
                        contentWithoutYamlOrLinks: '# A1',
                        outgoingEdges: [{targetId: `${vaultRoot}/atlas/sector-a/a2.md`}],
                    },
                    [`${vaultRoot}/atlas/sector-a/a2.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/atlas/sector-a/a2.md`,
                        contentWithoutYamlOrLinks: '# A2',
                        outgoingEdges: [{targetId: `${vaultRoot}/atlas/sector-a/a1.md`}],
                    },
                    [`${vaultRoot}/atlas/sector-b/b1.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/atlas/sector-b/b1.md`,
                        contentWithoutYamlOrLinks: '# B1',
                        outgoingEdges: [{targetId: `${vaultRoot}/atlas/sector-b/b2.md`}],
                    },
                    [`${vaultRoot}/atlas/sector-b/b2.md`]: {
                        absoluteFilePathIsID: `${vaultRoot}/atlas/sector-b/b2.md`,
                        contentWithoutYamlOrLinks: '# B2',
                        outgoingEdges: [{targetId: `${vaultRoot}/atlas/sector-b/b1.md`}],
                    },
                },
            },
        }

        const rendered = buildRecursiveAscii(state, vaultRoot, {
            maxInlineEdges: 1,
            maxInlineNodes: Number.POSITIVE_INFINITY,
            maxDepth: 2,
        })
        const parsed = parseRecursiveAscii(rendered.text)
        const score = scoreRecursiveAscii(parsed, state, vaultRoot)
        const navigation = computeNavigationStats(parsed, state, vaultRoot, 20, 194)

        expect(rendered.text).toContain('[Main view]')
        expect(rendered.text).toContain('[Fragment fragment-1: atlas]')
        expect(rendered.text).toContain('▦ atlas [5 nodes, 6 edges, a=1] → fragment-1')
        expect(rendered.text).toContain('root.md -> fragment-1::atlas/atlas-index.md')
        expect(parsed.fragmentOrder).toEqual(['main', 'fragment-1', 'fragment-2', 'fragment-3'])
        expect(parsed.nodeToFragment.get('atlas/sector-a/a1.md')).toBe('fragment-2')
        expect(parsed.nodeToFragment.get('atlas/sector-b/b1.md')).toBe('fragment-3')
        expect(score.nodeFidelity).toBe(1)
        expect(score.edgeFidelity).toBe(1)
        expect(navigation.meanCost).toBeGreaterThan(1)
    })
})
