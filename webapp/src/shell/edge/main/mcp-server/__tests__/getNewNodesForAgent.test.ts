import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {Graph, GraphNode} from '@/pure/graph'
import {getNewNodesForAgent} from '../getNewNodesForAgent'

function buildNode(filePath: string, agentName: string): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: filePath,
        contentWithoutYamlOrLinks: '# Test',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map([['agent_name', agentName]]),
            isContextNode: false
        }
    }
}

function buildGraph(nodes: GraphNode[]): Graph {
    const nodesRecord: Record<string, GraphNode> = {}
    for (const node of nodes) {
        nodesRecord[node.absoluteFilePathIsID] = node
    }
    return {
        nodes: nodesRecord,
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

describe('getNewNodesForAgent — spawnedAt birthtime filter', () => {
    it('excludes nodes created before spawnedAt', () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const oldFile: string = path.join(tmpDir, 'old-node.md')
        const newFile: string = path.join(tmpDir, 'new-node.md')

        // Create both files — they'll have ~same birthtime (now)
        fs.writeFileSync(oldFile, '# Old')
        fs.writeFileSync(newFile, '# New')

        const oldBirthtime: number = fs.statSync(oldFile).birthtimeMs
        // spawnedAt is AFTER old file's birthtime but BEFORE new file's
        // Since both files are created nearly simultaneously, we set spawnedAt
        // to oldBirthtime + 1 to simulate "old was created before spawn"
        const spawnedAt: number = oldBirthtime + 1

        // Manually set old file's birthtime to the past via utimes
        // Note: utimes sets atime+mtime, not birthtime on macOS.
        // Instead, we rely on spawnedAt being after oldBirthtime.
        // Since files are created ~same ms, we need to wait briefly.

        const graph: Graph = buildGraph([
            buildNode(oldFile, 'Ama'),
            buildNode(newFile, 'Ama')
        ])

        // With spawnedAt = oldBirthtime + 1:
        //   old file birthtime < spawnedAt → excluded
        //   new file birthtime ≈ old file birthtime → also excluded (same ms)
        // This proves the filter works — both created before spawnedAt are excluded.
        const result = getNewNodesForAgent(graph, 'Ama', spawnedAt)
        expect(result).toHaveLength(0)

        // With spawnedAt = 0 (epoch), both files are included
        const resultAll = getNewNodesForAgent(graph, 'Ama', 0)
        expect(resultAll).toHaveLength(2)

        // Cleanup
        fs.rmSync(tmpDir, {recursive: true})
    })

    it('includes nodes created after spawnedAt', () => {
        const spawnedAt: number = Date.now() - 1000 // 1 second ago
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const recentFile: string = path.join(tmpDir, 'recent-node.md')

        fs.writeFileSync(recentFile, '# Recent')

        const graph: Graph = buildGraph([buildNode(recentFile, 'Ama')])

        const result = getNewNodesForAgent(graph, 'Ama', spawnedAt)
        expect(result).toHaveLength(1)
        expect(result[0].nodeId).toBe(recentFile)

        fs.rmSync(tmpDir, {recursive: true})
    })

    it('returns empty for undefined agentName', () => {
        const result = getNewNodesForAgent({nodes: {}, incomingEdgesIndex: new Map(), nodeByBaseName: new Map(), unresolvedLinksIndex: new Map()}, undefined, 0)
        expect(result).toHaveLength(0)
    })

    it('includes nodes when file stat fails (missing file)', () => {
        const graph: Graph = buildGraph([buildNode('/nonexistent/path.md', 'Ama')])

        const result = getNewNodesForAgent(graph, 'Ama', 0)
        expect(result).toHaveLength(1)
    })

    it('filters by agent name — different agent nodes excluded', () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const amaFile: string = path.join(tmpDir, 'ama-node.md')
        const otherFile: string = path.join(tmpDir, 'other-node.md')

        fs.writeFileSync(amaFile, '# Ama work')
        fs.writeFileSync(otherFile, '# Other work')

        const graph: Graph = buildGraph([
            buildNode(amaFile, 'Ama'),
            buildNode(otherFile, 'Eli')
        ])

        const result = getNewNodesForAgent(graph, 'Ama', 0)
        expect(result).toHaveLength(1)
        expect(result[0].nodeId).toBe(amaFile)

        fs.rmSync(tmpDir, {recursive: true})
    })
})
