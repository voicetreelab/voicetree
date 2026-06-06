/**
 * Integration tests for the idle stop-gate audit's finish-gate behaviour.
 *
 * The agent is given an EMPTY graph, so `runStopHooks` short-circuits on its
 * no-progress-nodes gate and the audit's outcome is driven solely by
 * `requireDeclaredStatus`. We assert on the observable side effect — the
 * messages actually injected into the terminal, captured in a log — rather than
 * on mock-call matchers.
 */
import {describe, it, expect, beforeEach, vi} from 'vitest'
import type {Graph} from '@vt/graph-model/graph'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {AgentStatus, TerminalId, TerminalRecord} from '@vt/vt-daemon-protocol'

// Observable side-effect log: every message injected into a terminal lands here.
const mockSentMessages: Array<{terminalId: string; text: string}> = []
vi.mock('@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts', () => ({
    sendTextToTerminal: (terminalId: string, text: string): Promise<{success: boolean}> => {
        mockSentMessages.push({terminalId, text})
        return Promise.resolve({success: true})
    },
}))

import {createTerminalData} from '../terminal-registry/types'
import {runIdleStopGateAudit, type IdleStopGateAuditDeps} from './runIdleStopGateAudit'

const EMPTY_GRAPH: Graph = {nodes: {}} as unknown as Graph

function record(lastReportedStatus: AgentStatus | null, over: Partial<TerminalRecord> = {}): TerminalRecord {
    const terminalData = createTerminalData({
        terminalId: 't1' as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'Ari',
    })
    return {
        terminalId: 't1',
        terminalData: {...terminalData, lastReportedStatus},
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 0,
        ...over,
    }
}

function makeDeps(rec: TerminalRecord): {deps: IdleStopGateAuditDeps; retries: string[]} {
    const retries: string[] = []
    return {
        deps: {
            records: [rec],
            graph: EMPTY_GRAPH,
            incrementAuditRetryCount: (id: string): void => {retries.push(id)},
            logger: {info: (): void => {}, error: (): void => {}},
        },
        retries,
    }
}

describe('runIdleStopGateAudit — finish gate', () => {
    beforeEach(() => {mockSentMessages.length = 0})

    it('nudges an idle agent that never declared a status', async () => {
        const rec = record(null)
        const {deps, retries} = makeDeps(rec)
        await runIdleStopGateAudit('t1', rec, deps)
        expect(mockSentMessages).toHaveLength(1)
        expect(mockSentMessages[0].terminalId).toBe('t1')
        expect(mockSentMessages[0].text).toContain('vt agent status')
        expect(retries).toEqual(['t1'])
    })

    it('nudges an idle agent whose last declared status was "working"', async () => {
        const rec = record('working')
        const {deps} = makeDeps(rec)
        await runIdleStopGateAudit('t1', rec, deps)
        expect(mockSentMessages).toHaveLength(1)
    })

    it.each<AgentStatus>(['done', 'failed', 'awaiting_input'])(
        'leaves an agent alone once it declared a terminal status (%s)',
        async (status) => {
            const rec = record(status)
            const {deps, retries} = makeDeps(rec)
            await runIdleStopGateAudit('t1', rec, deps)
            expect(mockSentMessages).toHaveLength(0)
            expect(retries).toEqual([])
        },
    )

    it('skips headless agents (they report via tools, not a terminal)', async () => {
        const base = record(null)
        const rec: TerminalRecord = {...base, terminalData: {...base.terminalData, isHeadless: true}}
        const {deps} = makeDeps(rec)
        await runIdleStopGateAudit('t1', rec, deps)
        expect(mockSentMessages).toHaveLength(0)
    })

    it('stops nudging once the retry cap is reached', async () => {
        const rec = record(null, {auditRetryCount: 2})
        const {deps} = makeDeps(rec)
        await runIdleStopGateAudit('t1', rec, deps)
        expect(mockSentMessages).toHaveLength(0)
    })
})
