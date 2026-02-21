/**
 * TDD unit tests for terminal-registry headless query functions.
 *
 * Tests getHeadlessAgentsForNode() — the query that badge UI uses
 * to find headless agents anchored to a specific task node.
 *
 * These tests use the REAL registry functions (recordTerminalSpawn,
 * clearTerminalRecords, getHeadlessAgentsForNode) while mocking
 * their side effects (UI sync, graph access, etc.).
 */

import {describe, it, expect, vi, beforeEach} from 'vitest'
import type {NodeIdAndFilePath} from '@/pure/graph'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import {createTerminalData} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData, CreateTerminalDataParams} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// ─── Mocks for side-effect modules ─────────────────────────────────────────

// uiAPI.syncTerminals is called by pushStateToRenderer inside registry mutations
vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {
        syncTerminals: vi.fn()
    }
}))

// These are imported by terminal-registry but not used in our test path
vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: vi.fn(() => ({nodes: {}, edges: {}, nodeByBaseName: {}}))
}))

vi.mock('@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode', () => ({
    getUnseenNodesAroundContextNode: vi.fn(async () => [])
}))

vi.mock('@/pure/graph/markdown-parsing', () => ({
    getNodeTitle: vi.fn(() => 'Mock Title')
}))

vi.mock('@/shell/edge/main/terminals/send-text-to-terminal', () => ({
    sendTextToTerminal: vi.fn()
}))

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: vi.fn(async () => ({autoNotifyUnseenNodes: false}))
}))

// ─── Import module under test AFTER mocks ──────────────────────────────────

import {
    recordTerminalSpawn,
    clearTerminalRecords,
    getHeadlessAgentsForNode,
    type TerminalRecord
} from '@/shell/edge/main/terminals/terminal-registry'

// ─── Test helpers ──────────────────────────────────────────────────────────

const TASK_NODE_A: NodeIdAndFilePath = '/vault/task-a.md' as NodeIdAndFilePath
const TASK_NODE_B: NodeIdAndFilePath = '/vault/task-b.md' as NodeIdAndFilePath

function buildTerminalData(params: {
    terminalId: string
    isHeadless: boolean
    anchoredToNodeId?: NodeIdAndFilePath
}): TerminalData {
    const createParams: CreateTerminalDataParams = {
        terminalId: params.terminalId as TerminalId,
        attachedToNodeId: 'ctx-node.md' as NodeIdAndFilePath,
        terminalCount: 0,
        title: `Agent ${params.terminalId}`,
        agentName: params.terminalId,
        isHeadless: params.isHeadless,
        anchoredToNodeId: params.anchoredToNodeId,
    }
    return createTerminalData(createParams)
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('getHeadlessAgentsForNode', () => {
    beforeEach(() => {
        clearTerminalRecords()
    })

    it('returns headless terminals anchored to the given node', () => {
        const headlessData: TerminalData = buildTerminalData({
            terminalId: 'headless-1',
            isHeadless: true,
            anchoredToNodeId: TASK_NODE_A
        })
        recordTerminalSpawn('headless-1', headlessData)

        const result: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)

        expect(result).toHaveLength(1)
        expect(result[0].terminalId).toBe('headless-1')
        expect(result[0].terminalData.isHeadless).toBe(true)
    })

    it('returns empty array when no headless agents exist', () => {
        const result: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)
        expect(result).toEqual([])
    })

    it('returns empty array for non-headless terminals anchored to same node', () => {
        const interactiveData: TerminalData = buildTerminalData({
            terminalId: 'interactive-1',
            isHeadless: false,
            anchoredToNodeId: TASK_NODE_A
        })
        recordTerminalSpawn('interactive-1', interactiveData)

        const result: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)
        expect(result).toEqual([])
    })

    it('filters by node ID — does not return agents anchored to different nodes', () => {
        const agentOnNodeA: TerminalData = buildTerminalData({
            terminalId: 'headless-a',
            isHeadless: true,
            anchoredToNodeId: TASK_NODE_A
        })
        const agentOnNodeB: TerminalData = buildTerminalData({
            terminalId: 'headless-b',
            isHeadless: true,
            anchoredToNodeId: TASK_NODE_B
        })
        recordTerminalSpawn('headless-a', agentOnNodeA)
        recordTerminalSpawn('headless-b', agentOnNodeB)

        const resultA: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)
        expect(resultA).toHaveLength(1)
        expect(resultA[0].terminalId).toBe('headless-a')

        const resultB: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_B)
        expect(resultB).toHaveLength(1)
        expect(resultB[0].terminalId).toBe('headless-b')
    })

    it('returns multiple headless agents when several are anchored to same node', () => {
        const agent1: TerminalData = buildTerminalData({
            terminalId: 'headless-multi-1',
            isHeadless: true,
            anchoredToNodeId: TASK_NODE_A
        })
        const agent2: TerminalData = buildTerminalData({
            terminalId: 'headless-multi-2',
            isHeadless: true,
            anchoredToNodeId: TASK_NODE_A
        })
        recordTerminalSpawn('headless-multi-1', agent1)
        recordTerminalSpawn('headless-multi-2', agent2)

        const result: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)
        expect(result).toHaveLength(2)
        const ids: string[] = result.map((r: TerminalRecord) => r.terminalId)
        expect(ids).toContain('headless-multi-1')
        expect(ids).toContain('headless-multi-2')
    })

    it('returns empty for headless agents with no anchoredToNodeId', () => {
        // Agents without anchoredToNodeId have Option.none — should not match any query
        const unanchoredData: TerminalData = buildTerminalData({
            terminalId: 'headless-unanchored',
            isHeadless: true,
            // No anchoredToNodeId → defaults to O.none
        })
        recordTerminalSpawn('headless-unanchored', unanchoredData)

        const result: TerminalRecord[] = getHeadlessAgentsForNode(TASK_NODE_A)
        expect(result).toEqual([])
    })
})
