/**
 * Black-box tests for `readTerminalOutputTool`.
 *
 * Focus: the three observable states a caller sees from the same API surface.
 *
 *  1. Terminal exists, PTY has emitted no output yet — `success: true`,
 *     `output: ''`. This was historically a `success: false, error: "No
 *     output buffer for terminal: ..."` response, which read like a hard
 *     failure and caused callers to retry without backoff (or give up
 *     entirely) when the right thing was "wait and poll".
 *  2. Terminal not registered, not pending — `success: false`, error.
 *  3. Terminal pending (spawn returned but PTY not registered yet) —
 *     `success: true`, `pending: true`, `output: ''`.
 *
 * Tests register real terminal records via the public registry API; no
 * internal mocks. The registry state is cleared between tests so cases
 * don't leak.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
    clearTerminalRecords,
    recordTerminalPending,
    recordTerminalSpawn,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import {readTerminalOutputTool} from './readTerminalOutputTool'

const CALLER_ID: TerminalId = 'caller-Aki' as TerminalId

function makeTerminalData(terminalId: TerminalId, isHeadless: boolean): TerminalData {
    return {
        type: 'Terminal',
        terminalId,
        attachedToContextNodeId: '/ctx',
        terminalCount: 1,
        title: 'test',
        anchoredToNodeId: O.none,
        initialEnvVars: {},
        initialSpawnDirectory: '/tmp',
        initialCommand: null,
        executeCommand: false,
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'spawning',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Aki',
        worktreeName: undefined,
        isHeadless,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
    }
}

function parsePayload(response: Awaited<ReturnType<typeof readTerminalOutputTool>>): {
    readonly success: boolean
    readonly output?: string
    readonly error?: string
    readonly pending?: boolean
    readonly isHeadless?: boolean
} {
    return JSON.parse(response.content[0]?.text ?? '{}')
}

describe('readTerminalOutputTool', () => {
    beforeEach(() => {
        clearTerminalRecords()
        // The caller must exist for the tool to accept the request.
        recordTerminalSpawn(CALLER_ID, makeTerminalData(CALLER_ID, false))
    })

    afterEach(() => {
        clearTerminalRecords()
    })

    it('returns success with empty output when an interactive terminal has no PTY output yet', async () => {
        const target: TerminalId = 'target-Bee' as TerminalId
        recordTerminalSpawn(target, makeTerminalData(target, false))

        const response = await readTerminalOutputTool({
            terminalId: target,
            callerTerminalId: CALLER_ID,
        })

        const payload = parsePayload(response)
        expect(payload.success).toBe(true)
        expect(payload.output).toBe('')
        expect(payload.isHeadless).toBe(false)
        expect(payload.error).toBeUndefined()
    })

    it('returns error when the terminal does not exist and is not pending', async () => {
        const response = await readTerminalOutputTool({
            terminalId: 'never-spawned',
            callerTerminalId: CALLER_ID,
        })

        const payload = parsePayload(response)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Terminal not found')
    })

    it('returns success with pending=true when the terminal is mid-spawn', async () => {
        recordTerminalPending('pending-Cee', false)

        const response = await readTerminalOutputTool({
            terminalId: 'pending-Cee',
            callerTerminalId: CALLER_ID,
        })

        const payload = parsePayload(response)
        expect(payload.success).toBe(true)
        expect(payload.pending).toBe(true)
        expect(payload.output).toBe('')
    })

    it('returns error when the caller terminal is unknown', async () => {
        const response = await readTerminalOutputTool({
            terminalId: 'whatever',
            callerTerminalId: 'unknown-caller',
        })

        const payload = parsePayload(response)
        expect(payload.success).toBe(false)
        expect(payload.error).toContain('Unknown caller terminal')
    })
})
