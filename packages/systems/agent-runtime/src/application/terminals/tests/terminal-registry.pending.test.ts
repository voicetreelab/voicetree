/**
 * Phase 3a: pending terminal state.
 *
 * BEHAVIOR TESTED:
 * - recordTerminalPending registers pending entries
 * - enqueuePendingMessage queues messages while pending
 * - recordTerminalSpawn drains queued messages via sendTextToTerminal
 * - clearPendingTerminal removes pending entry without draining
 *
 * Spec Reference: consolidate-terminal-registry phase 3a
 */

import {describe, it, expect, beforeEach, vi, type Mock} from 'vitest'
import {createTerminalData, type TerminalId} from '../terminal-registry/types'
import type {TerminalData} from '../terminal-registry/types'
import {
    recordTerminalSpawn,
    recordTerminalPending,
    getPendingTerminal,
    getPendingTerminals,
    enqueuePendingMessage,
    clearPendingTerminal,
    clearTerminalRecords
} from '../terminal-registry'

const mockSendTextToTerminal: Mock = vi.fn().mockResolvedValue({ success: true })
vi.mock('@vt/vt-daemon/agents/inject/send-text-to-terminal.ts', () => ({
    sendTextToTerminal: (terminalId: string, text: string): Promise<{ success: boolean }> =>
        mockSendTextToTerminal(terminalId, text)
}))

describe('Terminal Registry - Pending state (Phase 3a)', () => {
    beforeEach(() => {
        clearTerminalRecords()
        vi.clearAllMocks()
    })

    it('recordTerminalPending registers a pending entry that getPendingTerminal exposes', () => {
        recordTerminalPending('pending-1', false)
        const pending: { readonly isHeadless: boolean } | undefined = getPendingTerminal('pending-1')
        expect(pending).toEqual({ isHeadless: false })
    })

    it('recordTerminalPending records the headless flag', () => {
        recordTerminalPending('pending-headless', true)
        expect(getPendingTerminal('pending-headless')?.isHeadless).toBe(true)
    })

    it('getPendingTerminals returns all pending terminal ids with headless flags', () => {
        recordTerminalPending('pending-interactive', false)
        recordTerminalPending('pending-headless', true)

        expect(getPendingTerminals()).toEqual([
            {terminalId: 'pending-interactive', isHeadless: false},
            {terminalId: 'pending-headless', isHeadless: true},
        ])
    })

    it('recordTerminalPending is a no-op when an entry already exists', () => {
        recordTerminalPending('pending-1', false)
        recordTerminalPending('pending-1', true) // second call should not overwrite
        expect(getPendingTerminal('pending-1')?.isHeadless).toBe(false)
    })

    it('recordTerminalPending is a no-op when the terminal is already running', () => {
        const data: TerminalData = createTerminalData({
            attachedToNodeId: 'node-1.md',
            terminalCount: 0,
            title: 'Running'
        })
        recordTerminalSpawn('running-1', data)
        recordTerminalPending('running-1', false)
        expect(getPendingTerminal('running-1')).toBeUndefined()
    })

    it('enqueuePendingMessage returns true while pending and queues the message', () => {
        recordTerminalPending('pending-1', false)
        const ok: boolean = enqueuePendingMessage('pending-1', 'hello')
        expect(ok).toBe(true)
    })

    it('enqueuePendingMessage returns false when no pending entry exists', () => {
        const ok: boolean = enqueuePendingMessage('unknown', 'hello')
        expect(ok).toBe(false)
    })

    it('recordTerminalSpawn clears the pending entry', () => {
        recordTerminalPending('pending-1', false)
        const data: TerminalData = createTerminalData({
            attachedToNodeId: 'pending-1.md',
            terminalCount: 0,
            title: 'Spawned',
            agentName: 'pending-1'
        })
        recordTerminalSpawn('pending-1' as TerminalId, data)
        expect(getPendingTerminal('pending-1')).toBeUndefined()
    })

    it('recordTerminalSpawn drains queued messages via sendTextToTerminal', () => {
        recordTerminalPending('pending-1', false)
        enqueuePendingMessage('pending-1', 'msg-1')
        enqueuePendingMessage('pending-1', 'msg-2')

        const data: TerminalData = createTerminalData({
            attachedToNodeId: 'pending-1.md',
            terminalCount: 0,
            title: 'Spawned',
            agentName: 'pending-1'
        })
        recordTerminalSpawn('pending-1' as TerminalId, data)

        expect(mockSendTextToTerminal).toHaveBeenCalledTimes(2)
        expect(mockSendTextToTerminal).toHaveBeenNthCalledWith(1, 'pending-1', 'msg-1')
        expect(mockSendTextToTerminal).toHaveBeenNthCalledWith(2, 'pending-1', 'msg-2')
    })

    it('clearPendingTerminal removes pending entry without draining', () => {
        recordTerminalPending('pending-1', false)
        enqueuePendingMessage('pending-1', 'should-not-send')
        clearPendingTerminal('pending-1')

        expect(getPendingTerminal('pending-1')).toBeUndefined()
        expect(mockSendTextToTerminal).not.toHaveBeenCalled()
    })

    it('clearTerminalRecords also clears pending entries', () => {
        recordTerminalPending('pending-1', false)
        clearTerminalRecords()
        expect(getPendingTerminal('pending-1')).toBeUndefined()
    })
})
