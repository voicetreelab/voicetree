import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from './'
import {
    getFolderParent,
    getFolderChildNodeIds,
    getFolderDescendantNodeIds,
    getSubFolderPaths,
    computeSyntheticEdgeSpecs,
    computeExpandPlan,
    findCollapsedAncestor,
    absolutePathToGraphFolderId
} from './folderCollapse'

// ── Test helpers ──

function makeNode(overrides: Partial<GraphNode> & { outgoingEdges?: GraphNode['outgoingEdges'] } = {}): GraphNode {
    const { kind = 'leaf', ...restOverrides } = overrides

    return {
        kind,
        absoluteFilePathIsID: '',
        contentWithoutYamlOrLinks: '',
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        },
        ...restOverrides
    }
}

function makeGraph(
    nodes: Record<string, GraphNode>,
    incomingIndex?: ReadonlyMap<string, readonly string[]>
): Graph {
    // Auto-build incoming index if not provided
    const incoming: Map<string, string[]> = new Map()
    if (!incomingIndex) {
        for (const [nodeId, node] of Object.entries(nodes)) {
            for (const edge of node.outgoingEdges) {
                const list: string[] = incoming.get(edge.targetId) ?? []
                list.push(nodeId)
                incoming.set(edge.targetId, list)
            }
        }
    }
    return {
        nodes,
        incomingEdgesIndex: incomingIndex ?? incoming,
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

// ── helper exports ──

describe('getFolderParent', () => {
    it('should return the parent folder for nested files and folders', () => {
        expect(getFolderParent('folder/child.md')).toBe('folder/')
        expect(getFolderParent('folder/sub/')).toBe('folder/sub/')
    })

    it('should return null for root-level files', () => {
        expect(getFolderParent('root.md')).toBeNull()
    })
})

describe('getFolderChildNodeIds', () => {
    it('should return only direct non-context children of a folder', () => {
        const nodes: Record<string, GraphNode> = {
            'folder/direct.md': makeNode(),
            'folder/context.md': makeNode({
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            }),
            'folder/sub/nested.md': makeNode(),
            'outside.md': makeNode()
        }

        expect(getFolderChildNodeIds(nodes, 'folder/')).toEqual(['folder/direct.md'])
    })
})

describe('getFolderDescendantNodeIds', () => {
    it('should include nested descendants while excluding context nodes', () => {
        const nodes: Record<string, GraphNode> = {
            'folder/direct.md': makeNode(),
            'folder/sub/nested.md': makeNode(),
            'folder/context.md': makeNode({
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            }),
            'outside.md': makeNode()
        }

        expect(getFolderDescendantNodeIds(nodes, 'folder/')).toEqual([
            'folder/direct.md',
            'folder/sub/nested.md'
        ])
    })
})

describe('getSubFolderPaths', () => {
    it('should derive unique immediate subfolders from nested descendants', () => {
        const nodes: Record<string, GraphNode> = {
            'folder/direct.md': makeNode(),
            'folder/alpha/one.md': makeNode(),
            'folder/alpha/two.md': makeNode(),
            'folder/beta/nested/three.md': makeNode(),
            'outside/gamma.md': makeNode()
        }

        expect(getSubFolderPaths(nodes, 'folder/')).toEqual([
            'folder/alpha/',
            'folder/beta/'
        ])
    })
})

// ── computeSyntheticEdgeSpecs ──

describe('computeSyntheticEdgeSpecs', () => {
    it('should detect incoming edges (external → descendant)', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md']),
            [{ sourceId: 'outside.md', targetId: 'folder/a.md', label: 'ref' }]
        )
        expect(result).toHaveLength(1)
        expect(result[0].direction).toBe('incoming')
        expect(result[0].externalNodeId).toBe('outside.md')
        expect(result[0].originalEdges).toEqual([
            { sourceId: 'outside.md', targetId: 'folder/a.md', label: 'ref' }
        ])
    })

    it('should detect outgoing edges (descendant → external)', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md']),
            [{ sourceId: 'folder/a.md', targetId: 'outside.md', label: 'link' }]
        )
        expect(result).toHaveLength(1)
        expect(result[0].direction).toBe('outgoing')
        expect(result[0].externalNodeId).toBe('outside.md')
        expect(result[0].syntheticEdgeId).toBe('synthetic:folder/:out:outside.md')
    })

    it('should group multiple edges to same external node', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md', 'folder/b.md']),
            [
                { sourceId: 'folder/a.md', targetId: 'outside.md' },
                { sourceId: 'folder/b.md', targetId: 'outside.md', label: 'ref' }
            ]
        )
        expect(result).toHaveLength(1)
        expect(result[0].originalEdges).toHaveLength(2)
    })

    it('should separate edges to different external nodes', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md']),
            [
                { sourceId: 'folder/a.md', targetId: 'ext1.md' },
                { sourceId: 'folder/a.md', targetId: 'ext2.md' }
            ]
        )
        expect(result).toHaveLength(2)
        const ids = result.map(r => r.externalNodeId).sort()
        expect(ids).toEqual(['ext1.md', 'ext2.md'])
    })

    it('should filter internal edges (both endpoints inside folder)', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md', 'folder/b.md']),
            [{ sourceId: 'folder/a.md', targetId: 'folder/b.md' }]
        )
        expect(result).toHaveLength(0)
    })

    it('should return empty array when no edges', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md']),
            []
        )
        expect(result).toHaveLength(0)
    })

    it('should generate stable synthetic edge IDs', () => {
        const result = computeSyntheticEdgeSpecs(
            'auth/',
            new Set(['auth/', 'auth/login.md']),
            [{ sourceId: 'home.md', targetId: 'auth/login.md' }]
        )
        expect(result[0].syntheticEdgeId).toBe('synthetic:auth/:in:home.md')
    })

    it('should partition specs by direction even for the same external node', () => {
        const result = computeSyntheticEdgeSpecs(
            'folder/',
            new Set(['folder/', 'folder/a.md', 'folder/b.md']),
            [
                { sourceId: 'folder/a.md', targetId: 'peer.md', label: 'out' },
                { sourceId: 'peer.md', targetId: 'folder/b.md', label: 'in' }
            ]
        )

        expect(result).toEqual([
            {
                syntheticEdgeId: 'synthetic:folder/:out:peer.md',
                direction: 'outgoing',
                externalNodeId: 'peer.md',
                originalEdges: [{ sourceId: 'folder/a.md', targetId: 'peer.md', label: 'out' }]
            },
            {
                syntheticEdgeId: 'synthetic:folder/:in:peer.md',
                direction: 'incoming',
                externalNodeId: 'peer.md',
                originalEdges: [{ sourceId: 'peer.md', targetId: 'folder/b.md', label: 'in' }]
            }
        ])
    })
})

// ── computeExpandPlan ──

describe('computeExpandPlan', () => {
    it('should return direct children and real edges', () => {
        const graph = makeGraph({
            'folder/a.md': makeNode({
                absoluteFilePathIsID: 'folder/a.md',
                outgoingEdges: [{ targetId: 'folder/b.md', label: '' }]
            }),
            'folder/b.md': makeNode({ absoluteFilePathIsID: 'folder/b.md' })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(),            // no other collapsed folders
            new Set(['folder/'])  // folder itself is visible
        )
        expect(plan.childNodes).toHaveLength(2)
        expect(plan.childNodes.map(c => c.id).sort()).toEqual(['folder/a.md', 'folder/b.md'])
        expect(plan.realEdges).toHaveLength(1)
        expect(plan.realEdges[0].source).toBe('folder/a.md')
        expect(plan.realEdges[0].target).toBe('folder/b.md')
        expect(plan.syntheticEdges).toHaveLength(0)
    })

    it('should include sub-folder paths', () => {
        const graph = makeGraph({
            'folder/sub/nested.md': makeNode({ absoluteFilePathIsID: 'folder/sub/nested.md' })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(),
            new Set(['folder/'])
        )
        expect(plan.subFolders).toContain('folder/sub/')
        // nested.md is a child of sub/ (non-collapsed), restored via subfolder expansion
        expect(plan.childNodes).toHaveLength(1)
        expect(plan.childNodes[0].id).toBe('folder/sub/nested.md')
    })

    it('should create synthetic edges when target is in collapsed folder', () => {
        const graph = makeGraph({
            'folder/a.md': makeNode({
                absoluteFilePathIsID: 'folder/a.md',
                outgoingEdges: [{ targetId: 'other/hidden.md', label: 'dep' }]
            }),
            'other/hidden.md': makeNode({ absoluteFilePathIsID: 'other/hidden.md' })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(['other/']),         // other/ is collapsed
            new Set(['folder/', 'other/'])
        )
        expect(plan.syntheticEdges).toHaveLength(1)
        expect(plan.syntheticEdges[0].folderId).toBe('other/')
        expect(plan.syntheticEdges[0].direction).toBe('incoming')
        expect(plan.syntheticEdges[0].externalId).toBe('folder/a.md')
        expect(plan.realEdges).toHaveLength(0)
    })

    it('should restore incoming edges from visible nodes', () => {
        const graph = makeGraph({
            'folder/a.md': makeNode({ absoluteFilePathIsID: 'folder/a.md' }),
            'root.md': makeNode({
                absoluteFilePathIsID: 'root.md',
                outgoingEdges: [{ targetId: 'folder/a.md', label: 'link' }]
            })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(),
            new Set(['folder/', 'root.md'])
        )
        expect(plan.realEdges).toHaveLength(1)
        expect(plan.realEdges[0].source).toBe('root.md')
        expect(plan.realEdges[0].target).toBe('folder/a.md')
        expect(plan.realEdges[0].label).toBe('link')
    })

    it('should create synthetic incoming edges when source is in collapsed folder', () => {
        const graph = makeGraph({
            'folder/a.md': makeNode({ absoluteFilePathIsID: 'folder/a.md' }),
            'collapsed/src.md': makeNode({
                absoluteFilePathIsID: 'collapsed/src.md',
                outgoingEdges: [{ targetId: 'folder/a.md', label: '' }]
            })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(['collapsed/']),
            new Set(['folder/', 'collapsed/'])
        )
        expect(plan.syntheticEdges).toHaveLength(1)
        expect(plan.syntheticEdges[0].folderId).toBe('collapsed/')
        expect(plan.syntheticEdges[0].direction).toBe('outgoing')
        expect(plan.syntheticEdges[0].externalId).toBe('folder/a.md')
    })

    it('should set parentFolder from node path', () => {
        const graph = makeGraph({
            'folder/child.md': makeNode({ absoluteFilePathIsID: 'folder/child.md' })
        })
        const plan = computeExpandPlan(
            graph, 'folder/',
            new Set(),
            new Set(['folder/'])
        )
        expect(plan.childNodes[0].parentFolder).toBe('folder/')
    })
})

// ── findCollapsedAncestor ──

describe('findCollapsedAncestor', () => {
    it('should return null when no ancestors are collapsed', () => {
        expect(findCollapsedAncestor('folder/child.md', new Set())).toBeNull()
    })

    it('should find direct parent when collapsed', () => {
        expect(findCollapsedAncestor(
            'folder/child.md',
            new Set(['folder/'])
        )).toBe('folder/')
    })

    it('should find deeply nested collapsed ancestor', () => {
        expect(findCollapsedAncestor(
            'a/b/c/deep.md',
            new Set(['a/'])
        )).toBe('a/')
    })

    it('should return nearest collapsed ancestor (not deepest)', () => {
        // Both a/ and a/b/ are collapsed — nearest to a/b/c/node.md is a/b/
        expect(findCollapsedAncestor(
            'a/b/c/node.md',
            new Set(['a/', 'a/b/'])
        )).toBe('a/b/')
    })

    it('should return null for root-level nodes (no folder parent)', () => {
        expect(findCollapsedAncestor('root.md', new Set(['folder/']))).toBeNull()
    })
})

// ── absolutePathToGraphFolderId ──

describe('absolutePathToGraphFolderId', () => {
    it('should preserve absolute path and append trailing slash', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/auth',
            '/Users/bob/project/src'
        )).toBe('/Users/bob/project/src/auth/')
    })

    it('should handle nested paths', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/components/ui',
            '/Users/bob/project/src'
        )).toBe('/Users/bob/project/src/components/ui/')
    })

    it('should normalize a trailing slash on child folder paths', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src/components/ui/',
            '/Users/bob/project/src'
        )).toBe('/Users/bob/project/src/components/ui/')
    })

    it('should return null for root path (same as tree root)', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src',
            '/Users/bob/project/src'
        )).toBeNull()
    })

    it('should return null for paths outside tree root', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/other/folder',
            '/Users/bob/project/src'
        )).toBeNull()
    })

    it('should return null for prefix-match without slash boundary', () => {
        expect(absolutePathToGraphFolderId(
            '/Users/bob/project/src-extras',
            '/Users/bob/project/src'
        )).toBeNull()
    })
})
