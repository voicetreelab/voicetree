import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type {Graph, GraphNode} from '@vt/graph-model/graph'
import {getNewNodesForAgent, getNewNodesForAgentIdentities} from './getNewNodesForAgent'

function buildNode(filePath: string, agentName: string | undefined): GraphNode {
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: filePath,
        contentWithoutYamlOrLinks: '# Test',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: agentName !== undefined ? { agent_name: agentName } : {},
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
    it('excludes nodes created before spawnedAt and includes nodes created after', async () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const oldFile: string = path.join(tmpDir, 'old-node.md')
        const newFile: string = path.join(tmpDir, 'new-node.md')

        // Pad with sleeps so old < spawnedAt < new regardless of fs birthtime granularity.
        fs.writeFileSync(oldFile, '# Old')
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        const spawnedAt: number = Date.now()
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        fs.writeFileSync(newFile, '# New')

        const graph: Graph = buildGraph([
            buildNode(oldFile, 'Ama'),
            buildNode(newFile, 'Ama')
        ])

        const result = getNewNodesForAgent(graph, 'Ama', spawnedAt)
        expect(result).toHaveLength(1)
        expect(result[0].nodeId).toBe(newFile)

        // With spawnedAt = 0 (epoch), both files are included
        const resultAll = getNewNodesForAgent(graph, 'Ama', 0)
        expect(resultAll).toHaveLength(2)

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

    it('matches multiple identities and de-duplicates node ids', () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const terminalFile: string = path.join(tmpDir, 'terminal-node.md')
        const configuredNameFile: string = path.join(tmpDir, 'configured-node.md')
        const duplicateFile: string = path.join(tmpDir, 'duplicate-node.md')

        fs.writeFileSync(terminalFile, '# Terminal id work')
        fs.writeFileSync(configuredNameFile, '# Configured name work')
        fs.writeFileSync(duplicateFile, '# Duplicate work')

        const graph: Graph = buildGraph([
            buildNode(terminalFile, 'Aki'),
            buildNode(configuredNameFile, 'Fake Agent'),
            buildNode(duplicateFile, 'Aki'),
            buildNode(duplicateFile, 'Fake Agent')
        ])

        const result = getNewNodesForAgentIdentities(graph, ['Fake Agent', 'Aki', 'Aki'], 0)

        expect(result.map(node => node.nodeId).sort()).toEqual([
            configuredNameFile,
            duplicateFile,
            terminalFile
        ].sort())

        fs.rmSync(tmpDir, {recursive: true})
    })

    it('falls back to tagged nodes when spawnedAt would exclude all matches', async () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const terminalFile: string = path.join(tmpDir, 'terminal-node.md')

        fs.writeFileSync(terminalFile, '# Terminal id work')
        await new Promise<void>(resolve => setTimeout(resolve, 50))
        const spawnedAtAfterNode: number = Date.now()

        const graph: Graph = buildGraph([buildNode(terminalFile, 'Aki')])

        const result = getNewNodesForAgentIdentities(graph, ['Aki'], spawnedAtAfterNode)

        expect(result).toHaveLength(1)
        expect(result[0].nodeId).toBe(terminalFile)

        fs.rmSync(tmpDir, {recursive: true})
    })

    it('recovers agent_name from node frontmatter when graph metadata lost YAML props', () => {
        const tmpDir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'))
        const terminalFile: string = path.join(tmpDir, 'terminal-node.md')

        fs.writeFileSync(terminalFile, '---\nagent_name: Aki\n---\n# Terminal id work\n')

        const graph: Graph = buildGraph([buildNode(terminalFile, undefined)])

        const result = getNewNodesForAgentIdentities(graph, ['Aki'], 0)

        expect(result).toHaveLength(1)
        expect(result[0].nodeId).toBe(terminalFile)

        fs.rmSync(tmpDir, {recursive: true})
    })
})
