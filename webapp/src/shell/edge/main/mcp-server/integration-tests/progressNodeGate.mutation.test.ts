import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import type {Graph} from '@vt/graph-model/pure/graph'

import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'

vi.mock('@/shell/edge/main/terminals/terminal-registry', () => ({
    getIdleSince: vi.fn()
}))

import {isAgentComplete} from '@/shell/edge/main/mcp-server/isAgentComplete'
import {registerAgentNodes, clearAgentNodes} from '@/shell/edge/main/mcp-server/agentNodeIndex'
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'

function buildGraph(): Graph {
    return {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map()
    }
}

function makeTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: `ctx-nodes/${agentName}.md`,
        terminalCount: 0,
        title: agentName,
        agentName,
        parentTerminalId: (parentTerminalId ?? undefined) as TerminalId | undefined
    })
}

function makeIdleTerminalData(id: string, agentName: string, parentTerminalId?: string | null): TerminalData {
    return {...makeTerminalData(id, agentName, parentTerminalId), isDone: true}
}

function makeRecord(id: string, data: TerminalData, status: 'running' | 'exited' = 'running'): TerminalRecord {
    return {
        terminalId: id,
        terminalData: data,
        status,
        exitCode: status === 'exited' ? 0 : null,
        auditRetryCount: 0,
        spawnedAt: 0
    }
}

describe('progress-node gate mutation coverage', () => {
    const NOW: number = 100_000
    const IDLE_SINCE: number = NOW - 10_000

    beforeEach(() => {
        clearAgentNodes()
        vi.clearAllMocks()
        vi.mocked(getIdleSince).mockReturnValue(IDLE_SINCE)
    })

    afterEach(() => {
        clearAgentNodes()
    })

    it('requires a progress node from the current terminal before completion', () => {
        const record: TerminalRecord = makeRecord(
            'terminal-current',
            makeIdleTerminalData('terminal-current', 'alpha')
        )
        record.spawnedAt = NOW - 60_000

        expect(isAgentComplete(record, buildGraph(), NOW, [record])).toBe(false)

        registerAgentNodes('terminal-current', [
            {nodeId: '/vault/current-progress.md', title: 'Current Progress'}
        ])

        expect(isAgentComplete(record, buildGraph(), NOW, [record])).toBe(true)
    })

    it('ignores stale node index entries from another terminal with the same agent name', () => {
        registerAgentNodes('terminal-old', [
            {nodeId: '/vault/old-progress.md', title: 'Old Progress'}
        ])

        const record: TerminalRecord = makeRecord(
            'terminal-new',
            makeIdleTerminalData('terminal-new', 'alpha')
        )
        record.spawnedAt = NOW - 60_000

        expect(isAgentComplete(record, buildGraph(), NOW, [record])).toBe(false)
    })

    it('treats invalid spawnedAt values as still blocked by the no-progress gate', () => {
        const record: TerminalRecord = makeRecord(
            'terminal-bad-spawn',
            makeIdleTerminalData('terminal-bad-spawn', 'beta')
        )
        record.spawnedAt = undefined as unknown as number

        expect(isAgentComplete(record, buildGraph(), NOW, [record])).toBe(false)
    })
})
