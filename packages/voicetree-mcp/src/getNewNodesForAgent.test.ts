import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'
import {getNewNodesForAgent} from './getNewNodesForAgent'

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
        // Read the file's real birthtime and compute spawnedAt relative to it.
        // This avoids the macOS limitation that utimes can't set birthtime —
        // we don't try to forge timestamps, we anchor the threshold to the
        // observed value so the comparison is deterministic.
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const file: string = path.join(tmpDir, 'node.md')
        fs.writeFileSync(file, '# Node')
        const fileBirthtime: number = fs.statSync(file).birthtimeMs

        const graph: Graph = buildGraph([buildNode(file, 'Ama')])

        // spawnedAt > birthtime → file predates the spawn → EXCLUDED
        const futureSpawn: number = fileBirthtime + 1000
        expect(getNewNodesForAgent(graph, 'Ama', futureSpawn)).toHaveLength(0)

        // spawnedAt ≤ birthtime → file is at or after spawn → INCLUDED
        const pastSpawn: number = fileBirthtime - 1
        expect(getNewNodesForAgent(graph, 'Ama', pastSpawn)).toHaveLength(1)

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
