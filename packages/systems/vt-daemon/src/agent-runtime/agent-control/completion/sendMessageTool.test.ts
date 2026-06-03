import {afterEach, describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
    clearTerminalRecords,
    recordTerminalSpawn,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {sendMessageTool} from '../sendMessageTool'

const sent: Array<{terminalId: string; text: string}> = []

vi.mock('@vt/vt-daemon/agent-runtime/inject/send-text-to-terminal.ts', () => ({
    sendTextToTerminal: async (terminalId: string, text: string): Promise<{success: boolean}> => {
        sent.push({terminalId, text})
        return {success: true}
    },
}))

function makeTerminalData(terminalId: TerminalId): TerminalData {
    return {
        type: 'Terminal',
        terminalId,
        attachedToContextNodeId: '/ctx',
        terminalCount: 1,
        title: 'target',
        anchoredToNodeId: O.none,
        initialEnvVars: {},
        initialSpawnDirectory: '/tmp',
        initialCommand: null,
        executeCommand: true,
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'running',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: terminalId,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
    }
}

function parsePayload(response: Awaited<ReturnType<typeof sendMessageTool>>): {
    readonly success: boolean
    readonly error?: string
    readonly terminalId?: string
} {
    return JSON.parse(response.content[0]?.text ?? '{}')
}

describe('sendMessageTool scoped caller addresses', () => {
    afterEach(() => {
        clearTerminalRecords()
        sent.length = 0
    })

    it('accepts a project-scoped external caller and preserves it in the reply hint', async () => {
        const target: TerminalId = 'Emi-2' as TerminalId
        recordTerminalSpawn(target, makeTerminalData(target))

        const response = await sendMessageTool({
            callerTerminalId: 'brain/Emi',
            terminalId: target,
            message: 'hello from another project',
        })

        expect(parsePayload(response)).toMatchObject({success: true, terminalId: target})
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({terminalId: target})
        expect(sent[0]?.text).toContain('[From: brain/Emi] hello from another project')
        expect(sent[0]?.text).toContain('vt agent send')
        expect(sent[0]?.text).toContain('brain/Emi')
    })

    it('still rejects an unscoped unknown caller', async () => {
        const target: TerminalId = 'Emi-2' as TerminalId
        recordTerminalSpawn(target, makeTerminalData(target))

        const response = await sendMessageTool({
            callerTerminalId: 'unknown-caller',
            terminalId: target,
            message: 'hello',
        })

        const payload = parsePayload(response)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown caller terminal')
        expect(sent).toHaveLength(0)
    })
})
