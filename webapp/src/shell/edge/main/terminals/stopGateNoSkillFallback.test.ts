/**
 * Tests for stopGateAudit.ts — no-SKILL fallback branch (lines 212-223).
 *
 * When a task node has NO SKILL.md reference, auditAgent creates a single
 * soft obligation for ~/brain/SKILL.md — the agent must mention it in a
 * progress node. The violation reason contains the absolute path.
 *
 * Also tests the buildDeficiencyPrompt message format (new header text).
 */

import {describe, it, expect, afterEach} from 'vitest'
import {auditAgent, buildDeficiencyPrompt, type ComplianceResult} from './stopGateAudit'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from './terminal-registry'
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

// ─── Temp HOME helpers ────────────────────────────────────────────────────────

const tempDirs: string[] = []

function makeTempHome(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stopgate-nosk-'))
    tempDirs.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, {recursive: true, force: true})
    }
})

// ─── auditAgent — no-SKILL fallback ──────────────────────────────────────────

describe('auditAgent — no-SKILL fallback to root ~/brain/SKILL.md', () => {
    // These tests use the REAL ~/brain/SKILL.md (which exists on disk).
    // The real HOME is not changed so the function finds the real SKILL.md.

    const taskNodeId: string = '/vault/task_nosk.md'

    function makeNoSkillGraph(nodeId: string, content: string): Graph {
        return {
            nodes: {[nodeId]: makeGraphNode(nodeId, content)},
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }
    }

    it('returns non-null result when task node has no SKILL.md reference', () => {
        const graph = makeNoSkillGraph(taskNodeId, 'A plain task with no skill reference.')
        const result: ComplianceResult | null = auditAgent('agent-a', graph, [makeRecord('agent-a', taskNodeId)])

        expect(result).not.toBeNull()
    })

    it('result is failed when agent has no progress nodes', () => {
        const graph = makeNoSkillGraph(taskNodeId, 'Do something with no skill reference.')
        const result: ComplianceResult | null = auditAgent('agent-b', graph, [makeRecord('agent-b', taskNodeId)])

        expect(result).not.toBeNull()
        expect(result!.passed).toBe(false)
    })

    it('violation reason contains absolute path to ~/brain/SKILL.md', () => {
        const graph = makeNoSkillGraph(taskNodeId, 'No skill reference here.')
        const result: ComplianceResult | null = auditAgent('agent-c', graph, [makeRecord('agent-c', taskNodeId)])

        expect(result).not.toBeNull()
        const absPath: string = (process.env.HOME ?? '') + '/brain/SKILL.md'
        const reasons: string[] = result!.violations.map(v => v.reason)
        expect(reasons.some(r => r.includes(absPath))).toBe(true)
    })

    it('violation obligation workflowPath is ~/brain/SKILL.md', () => {
        const graph = makeNoSkillGraph(taskNodeId, 'No skill reference.')
        const result: ComplianceResult | null = auditAgent('agent-d', graph, [makeRecord('agent-d', taskNodeId)])

        expect(result).not.toBeNull()
        const obligations = result!.violations.map(v => v.obligation)
        expect(obligations.some(o => o.workflowPath === '~/brain/SKILL.md')).toBe(true)
    })

    it('passes when agent progress node mentions ~/brain/SKILL.md', () => {
        const progressNodeId: string = '/vault/progress.md'
        const absPath: string = (process.env.HOME ?? '') + '/brain/SKILL.md'
        const progressNode: GraphNode = makeGraphNode(
            progressNodeId,
            `Read ${absPath} and followed all lifecycle steps.`,
            'agent-e'
        )
        const graph: Graph = {
            nodes: {
                [taskNodeId]: makeGraphNode(taskNodeId, 'No skill reference.'),
                [progressNodeId]: progressNode
            },
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map()
        }
        const result: ComplianceResult | null = auditAgent('agent-e', graph, [makeRecord('agent-e', taskNodeId)])

        expect(result).not.toBeNull()
        expect(result!.passed).toBe(true)
    })

    it('returns null when root ~/brain/SKILL.md does not exist', () => {
        const emptyHome: string = makeTempHome()
        const originalHome: string | undefined = process.env.HOME
        process.env.HOME = emptyHome
        try {
            const graph = makeNoSkillGraph(taskNodeId, 'No skill reference.')
            const result: ComplianceResult | null = auditAgent('agent-f', graph, [makeRecord('agent-f', taskNodeId)])
            expect(result).toBeNull()
        } finally {
            process.env.HOME = originalHome ?? ''
        }
    })
})

// ─── buildDeficiencyPrompt — message format ───────────────────────────────────

describe('buildDeficiencyPrompt — message format', () => {
    it('header includes "either spawn an agent on it OR read the SKILL.md yourself and address each point in a progress node"', () => {
        const result: ComplianceResult = {
            passed: false,
            violations: [{
                obligation: {workflowPath: '~/brain/SKILL.md', type: 'soft', workflowName: 'SKILL.md'},
                reason: 'You have not addressed "/Users/bobbobby/brain/SKILL.md". Either spawn an agent on it, or read it yourself and address each point in a progress node.'
            }]
        }
        const prompt: string = buildDeficiencyPrompt(result)
        expect(prompt).toContain('either spawn an agent on it OR read the SKILL.md yourself and address each point in a progress node')
    })
})
