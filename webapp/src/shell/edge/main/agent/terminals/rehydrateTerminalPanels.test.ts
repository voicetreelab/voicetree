/**
 * Black-box tests for the pure rehydration selector. Inputs (registry records)
 * → outputs (the panels to launch). No spies, no mocked internals — the impure
 * shell `rehydrateTerminalPanels` is just `selectTerminalsToRehydrate` piped
 * into `uiAPI.launchTerminalOntoUI`, so testing the selector covers the logic.
 */
import {describe, it, expect} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Option} from 'fp-ts/lib/Option.js'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {TerminalData, TerminalId, TerminalRecord} from '@vt/vt-daemon-client'
import {selectTerminalsToRehydrate} from './rehydrateTerminalPanels'

function makeTerminalData(id: string, contextNodeId: string): TerminalData {
    const noneOption: Option<NodeIdAndFilePath> = O.none
    return {
        type: 'Terminal',
        terminalId: id as TerminalId,
        attachedToContextNodeId: contextNodeId as NodeIdAndFilePath,
        terminalCount: 1,
        anchoredToNodeId: noneOption,
        title: `Terminal ${id}`,
        resizable: true,
        shadowNodeDimensions: {width: 320, height: 200},
        isPinned: false,
        isDone: false,
        lifecycle: 'spawning',
        statusPhrase: '',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'agent-' + id,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: 'plain',
    }
}

function makeRecord(
    id: string,
    status: TerminalRecord['status'],
    contextNodeId: string,
): TerminalRecord {
    return {
        terminalId: id,
        status,
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 1700000000000,
        terminalData: makeTerminalData(id, contextNodeId),
    }
}

describe('selectTerminalsToRehydrate', (): void => {
    it('returns one target per live terminal, carrying its context node + data', (): void => {
        const a: TerminalRecord = makeRecord('A', 'running', '/ctx/a.md')
        const b: TerminalRecord = makeRecord('B', 'running', '/ctx/b.md')

        const targets = selectTerminalsToRehydrate([a, b])

        expect(targets).toEqual([
            {contextNodeId: '/ctx/a.md', terminalData: a.terminalData},
            {contextNodeId: '/ctx/b.md', terminalData: b.terminalData},
        ])
    })

    it('drops exited terminals (their agent is gone — no panel)', (): void => {
        const live: TerminalRecord = makeRecord('Live', 'running', '/ctx/live.md')
        const dead: TerminalRecord = makeRecord('Dead', 'exited', '/ctx/dead.md')

        const targets = selectTerminalsToRehydrate([live, dead])

        expect(targets).toEqual([{contextNodeId: '/ctx/live.md', terminalData: live.terminalData}])
    })

    it('drops records with no attachedToContextNodeId (nothing to anchor a panel to)', (): void => {
        const anchored: TerminalRecord = makeRecord('Anchored', 'running', '/ctx/x.md')
        const orphan: TerminalRecord = makeRecord('Orphan', 'running', '')

        const targets = selectTerminalsToRehydrate([anchored, orphan])

        expect(targets).toEqual([{contextNodeId: '/ctx/x.md', terminalData: anchored.terminalData}])
    })

    it('returns empty for an empty registry', (): void => {
        expect(selectTerminalsToRehydrate([])).toEqual([])
    })
})
