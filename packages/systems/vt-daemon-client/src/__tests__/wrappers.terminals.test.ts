/**
 * Black-box integration test for the `terminals` wrapper facade.
 *
 * Boots a real loopback HTTP server speaking JSON-RPC 2.0, exercises
 * each of the 12 routes through the typed wrapper, and asserts both
 * sides of the wire:
 *   - request envelope produced by the wrapper (method + params),
 *   - typed response returned to the caller.
 *
 * No internal mocks; the only collaborator is the real HTTP transport
 * the fake server exposes. The fake is a `RouteResponder` table; each
 * responder receives the params and returns the JSON-RPC `result`.
 */

import {Option} from 'fp-ts/lib/Option.js'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import type {
    TerminalData,
    TerminalId,
    TerminalRecord,
    TerminalRecordPatch,
} from '@vt/vt-daemon-protocol'

import {bindVtDaemonClient} from '../wrappers/index.ts'
import {startFakeRpcServer, type FakeRpcServerHandle} from './fixtures/fakeRpcServer.ts'

function makeTerminalData(id: string): TerminalData {
    const noneOption: Option<NodeIdAndFilePath> = O.none
    return {
        type: 'Terminal',
        terminalId: id as TerminalId,
        attachedToContextNodeId: '/ctx/' + id + '.md' as NodeIdAndFilePath,
        terminalCount: 1,
        anchoredToNodeId: noneOption,
        title: 'Title ' + id,
        resizable: true,
        shadowNodeDimensions: {width: 100, height: 100},
        isPinned: false,
        isDone: false,
        lifecycle: 'spawning',
        statusPhrase: '',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'A-' + id,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: 'plain',
    }
}

function makeRecord(id: string): TerminalRecord {
    return {
        terminalId: id,
        terminalData: makeTerminalData(id),
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 0,
    }
}

describe('vt-daemon-client wrappers — terminals facade', (): void => {
    let server: FakeRpcServerHandle

    beforeEach(async (): Promise<void> => {
        server = await startFakeRpcServer({
            spawnPlainTerminal: () => null,
            spawnPlainTerminalWithNode: () => null,
            spawnTerminalWithContextNode: () => ({
                terminalId: 'agent-1',
                contextNodeId: '/ctx/new.md',
            }),
            sendTextToTerminal: () => ({success: true}),
            injectNodesIntoTerminal: () => ({success: true, injectedCount: 3}),
            getTerminalRecords: () => [makeRecord('T1'), makeRecord('T2')],
            getUnseenNodesForTerminal: () => [
                {nodeId: '/a.md', title: 'A', contentPreview: 'aaa'},
                {nodeId: '/b.md', title: 'B', contentPreview: 'bbb'},
            ],
            getExistingAgentNames: () => ['agentA', 'agentB'],
            closeHeadlessAgent: () => ({closed: true, wasRunning: false}),
            getHeadlessAgentOutput: () => 'STDOUT BUFFER',
            removeTerminalFromRegistry: () => null,
            patchTerminalRecord: () => null,
        })
    })

    afterEach(async (): Promise<void> => {
        await server.stop()
    })

    it('spawnPlainTerminal sends nodeId+terminalCount and resolves void', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        await vtd.terminals.spawnPlainTerminal({
            nodeId: '/n.md' as NodeIdAndFilePath,
            terminalCount: 2,
        })
        expect(server.received).toHaveLength(1)
        expect(server.received[0].method).toBe('spawnPlainTerminal')
        expect(server.received[0].params).toEqual({nodeId: '/n.md', terminalCount: 2})
    })

    it('spawnPlainTerminalWithNode sends position+terminalCount and resolves void', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const position: Position = {x: 10, y: 20}
        await vtd.terminals.spawnPlainTerminalWithNode({position, terminalCount: 1})
        expect(server.received[0].method).toBe('spawnPlainTerminalWithNode')
        expect(server.received[0].params).toEqual({position: {x: 10, y: 20}, terminalCount: 1})
    })

    it('spawnTerminalWithContextNode returns the typed {terminalId, contextNodeId} pair', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.terminals.spawnTerminalWithContextNode({
            taskNodeId: '/task.md' as NodeIdAndFilePath,
            agentCommand: 'claude',
            headless: false,
        })
        expect(result).toEqual({terminalId: 'agent-1', contextNodeId: '/ctx/new.md'})
        expect(server.received[0].method).toBe('spawnTerminalWithContextNode')
        expect(server.received[0].params).toMatchObject({
            taskNodeId: '/task.md',
            agentCommand: 'claude',
            headless: false,
        })
    })

    it('sendTextToTerminal threads {success} through', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.terminals.sendTextToTerminal({terminalId: 'T1', text: 'hello\n'})
        expect(result).toEqual({success: true})
        expect(server.received[0].method).toBe('sendTextToTerminal')
        expect(server.received[0].params).toEqual({terminalId: 'T1', text: 'hello\n'})
    })

    it('injectNodesIntoTerminal threads {success, injectedCount} through', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const result = await vtd.terminals.injectNodesIntoTerminal({
            terminalId: 'T1', nodeIds: ['/a.md', '/b.md', '/c.md'],
        })
        expect(result).toEqual({success: true, injectedCount: 3})
    })

    it('getTerminalRecords returns the array of TerminalRecord', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const records = await vtd.terminals.getTerminalRecords()
        expect(records).toHaveLength(2)
        expect(records[0].terminalId).toBe('T1')
        expect(records[1].terminalId).toBe('T2')
        // Default request is `{}` per the contract.
        expect(server.received[0].params).toEqual({})
    })

    it('getUnseenNodesForTerminal returns the UnseenNodeInfo array', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const unseen = await vtd.terminals.getUnseenNodesForTerminal({terminalId: 'T1'})
        expect(unseen).toEqual([
            {nodeId: '/a.md', title: 'A', contentPreview: 'aaa'},
            {nodeId: '/b.md', title: 'B', contentPreview: 'bbb'},
        ])
    })

    it('getExistingAgentNames returns the string array', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const names = await vtd.terminals.getExistingAgentNames()
        expect(names).toEqual(['agentA', 'agentB'])
    })

    it('closeHeadlessAgent returns the discriminated {closed, wasRunning} response', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const response = await vtd.terminals.closeHeadlessAgent({terminalId: 'T1' as TerminalId})
        expect(response).toEqual({closed: true, wasRunning: false})
    })

    it('getHeadlessAgentOutput returns the raw stdout string', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const output = await vtd.terminals.getHeadlessAgentOutput({terminalId: 'T1'})
        expect(output).toBe('STDOUT BUFFER')
    })

    it('removeTerminalFromRegistry resolves void with just {terminalId}', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        await vtd.terminals.removeTerminalFromRegistry({terminalId: 'T1'})
        expect(server.received[0].method).toBe('removeTerminalFromRegistry')
        expect(server.received[0].params).toEqual({terminalId: 'T1'})
    })

    it('patchTerminalRecord forwards the discriminated patch payload', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        const patch: TerminalRecordPatch = {kind: 'activity', value: {lastOutputTime: 42, activityCount: 7}}
        await vtd.terminals.patchTerminalRecord({terminalId: 'T1', patch})
        expect(server.received[0].method).toBe('patchTerminalRecord')
        expect(server.received[0].params).toEqual({
            terminalId: 'T1',
            patch: {kind: 'activity', value: {lastOutputTime: 42, activityCount: 7}},
        })
    })
})
