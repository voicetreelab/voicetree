/**
 * Integration tests for multi-SKILL obligation aggregation in stopGateAudit.ts
 *
 * TDD tests for the critical bug fix: when a task node references multiple SKILL.md
 * files, auditAgent must aggregate obligations from ALL of them, not just the first.
 *
 * Uses REAL auditAgent module. Mocks only external/UI leaf dependencies.
 * Creates temp SKILL.md files on disk that auditAgent reads via fs.readFileSync.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// ─── Mock external/UI leaf dependencies (must be before real imports) ────────

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {syncTerminals: vi.fn()}
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn().mockResolvedValue({success: true})
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn().mockResolvedValue({autoNotifyUnseenNodes: false})
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn().mockResolvedValue([])
}))

// ─── Real imports (after mocks) ──────────────────────────────────────────────

import {auditAgent, type ComplianceResult} from './stopGateAudit'
import type {TerminalRecord} from './terminal-registry'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGraphNode(nodeId: string, content: string, agentName?: string): GraphNode {
    const additionalYAMLProps: Map<string, string> = new Map()
    if (agentName) additionalYAMLProps.set('agent_name', agentName)
    return {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps,
            isContextNode: false
        }
    }
}

function makeRecord(id: string, anchoredToNodeId?: string): TerminalRecord {
    const terminalData: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${id}.md`,
        terminalCount: 0,
        title: id,
        agentName: id,
        anchoredToNodeId
    })
    return {
        terminalId: id,
        terminalData,
        status: 'running',
        exitCode: null,
        auditRetryCount: 0,
        spawnedAt: 0
    }
}

// ─── HOME management ─────────────────────────────────────────────────────────

let tempHome: string
let originalHome: string | undefined
let skillDir1: string
let skillDir2: string

beforeEach(() => {
    originalHome = process.env.HOME
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'multiskill-'))

    // Create two SKILL.md files under brain/workflows/
    skillDir1 = path.join(tempHome, 'brain', 'workflows', 'orchestration')
    skillDir2 = path.join(tempHome, 'brain', 'workflows', 'engineering', 'software-engineering')
    fs.mkdirSync(skillDir1, {recursive: true})
    fs.mkdirSync(skillDir2, {recursive: true})

    // SKILL 1: orchestration — has soft edge to swarm-sitrep
    fs.writeFileSync(path.join(skillDir1, 'SKILL.md'), `---
name: orchestration
---
# Orchestration
## Outgoing Workflows
[~/brain/workflows/meta/swarm-sitrep/SKILL.md]
`)

    // SKILL 2: software-engineering — has soft edge to e2e-testing
    fs.writeFileSync(path.join(skillDir2, 'SKILL.md'), `---
name: software-engineering
---
# Software Engineering
## Outgoing Workflows
[~/brain/workflows/engineering/e2e-testing/SKILL.md]
`)

    process.env.HOME = tempHome
})

afterEach(() => {
    fs.rmSync(tempHome, {recursive: true, force: true})
    process.env.HOME = originalHome ?? ''
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('multi-SKILL obligation aggregation', () => {
    it('audits obligations from BOTH skills when task references two SKILLs', () => {
        const taskContent: string = `Read ~/brain/workflows/orchestration/SKILL.md
Read ~/brain/workflows/engineering/software-engineering/SKILL.md`

        const taskNodeId: string = '/vault/task_multi.md'

        // Agent's progress node mentions orchestration + software-engineering (self obligations)
        // but NOT swarm-sitrep or e2e-testing (outgoing workflow obligations)
        const progressNodeId: string = '/vault/progress.md'
        const progressNode: GraphNode = makeGraphNode(
            progressNodeId,
            'Implemented the orchestration plan and software-engineering changes.',
            'test-agent'
        )

        const graph: Graph = {
            nodes: {
                [taskNodeId]: makeGraphNode(taskNodeId, taskContent),
                [progressNodeId]: progressNode
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }

        const record: TerminalRecord = makeRecord('test-agent', taskNodeId)
        const result: ComplianceResult | null = auditAgent('test-agent', graph, [record])

        expect(result).not.toBeNull()
        expect(result!.passed).toBe(false)

        // Should have violations from BOTH skills' outgoing workflows
        const violationReasons: string[] = result!.violations.map(v => v.reason)

        // From orchestration SKILL: soft edge to swarm-sitrep
        expect(violationReasons.some(r => r.includes('swarm-sitrep'))).toBe(true)

        // From SWE SKILL: soft edge to e2e-testing
        expect(violationReasons.some(r => r.includes('e2e-testing'))).toBe(true)
    })

    it('passes when agent addresses obligations from all skills', () => {
        const taskContent: string = `Read ~/brain/workflows/orchestration/SKILL.md
Read ~/brain/workflows/engineering/software-engineering/SKILL.md`

        const taskNodeId: string = '/vault/task_multi.md'
        const progressNode: GraphNode = makeGraphNode(
            '/vault/progress.md',
            'Implemented orchestration with swarm-sitrep check. e2e-testing covered by playwright tests. software-engineering complete.',
            'test-agent'
        )

        const graph: Graph = {
            nodes: {
                [taskNodeId]: makeGraphNode(taskNodeId, taskContent),
                ['/vault/progress.md']: progressNode
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }

        const record: TerminalRecord = makeRecord('test-agent', taskNodeId)
        const result: ComplianceResult | null = auditAgent('test-agent', graph, [record])

        expect(result).not.toBeNull()
        expect(result!.passed).toBe(true)
    })

    it('single SKILL still works (no regression)', () => {
        const taskContent: string = 'Read ~/brain/workflows/orchestration/SKILL.md'
        const taskNodeId: string = '/vault/task_single.md'
        const progressNode: GraphNode = makeGraphNode('/vault/progress.md', 'Did orchestration and swarm-sitrep check.', 'test-agent')

        const graph: Graph = {
            nodes: {
                [taskNodeId]: makeGraphNode(taskNodeId, taskContent),
                ['/vault/progress.md']: progressNode
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }

        const record: TerminalRecord = makeRecord('test-agent', taskNodeId)
        const result: ComplianceResult | null = auditAgent('test-agent', graph, [record])

        expect(result).not.toBeNull()
        expect(result!.passed).toBe(true)
    })

    it('deduplicates obligations when same SKILL referenced twice', () => {
        const taskContent: string = `Read ~/brain/workflows/orchestration/SKILL.md
Also see ~/brain/workflows/orchestration/SKILL.md again`

        const taskNodeId: string = '/vault/task_dup.md'
        const progressNode: GraphNode = makeGraphNode('/vault/progress.md', 'Did orchestration and swarm-sitrep.', 'test-agent')

        const graph: Graph = {
            nodes: {
                [taskNodeId]: makeGraphNode(taskNodeId, taskContent),
                ['/vault/progress.md']: progressNode
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }

        const record: TerminalRecord = makeRecord('test-agent', taskNodeId)
        const result: ComplianceResult | null = auditAgent('test-agent', graph, [record])

        // Should not double-count obligations from the same SKILL
        expect(result).not.toBeNull()
        expect(result!.passed).toBe(true)
    })
})
