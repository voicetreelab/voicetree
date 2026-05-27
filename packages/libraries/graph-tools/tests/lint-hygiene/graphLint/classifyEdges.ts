import { describe, it, expect } from 'vitest'
import { classifyEdges } from '../../../src/lint/graphLint'
import type { ClassifiedEdge, ContainmentTree } from '../../../src/lint/graphLint'

export const describeClassifyEdges = (): void => {
    describe('classifyEdges', () => {
        it('classifies parent, sibling, and cross-ref edges', () => {
            const tree: ContainmentTree = {
                parentOf: new Map([
                    ['child-a', 'root'],
                    ['child-b', 'root'],
                    ['root', null],
                ]),
                childrenOf: new Map([
                    ['root', ['child-a', 'child-b']],
                ]),
            }

            const allLinks: Map<string, string[]> = new Map([
                ['child-a', ['root', 'child-b', 'ext']],
            ])

            const edges: ClassifiedEdge[] = classifyEdges(allLinks, tree)

            expect(edges.find(e => e.source === 'child-a' && e.target === 'root')?.type).toBe('parent')
            expect(edges.find(e => e.source === 'child-a' && e.target === 'child-b')?.type).toBe('sibling')
            expect(edges.find(e => e.source === 'child-a' && e.target === 'ext')?.type).toBe('cross_ref')
        })
    })
}
