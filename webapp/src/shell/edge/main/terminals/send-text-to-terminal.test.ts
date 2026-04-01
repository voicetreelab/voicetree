import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {TerminalOperationResult} from './terminal-manager'

const mockWrite: ReturnType<typeof vi.fn<(terminalId: string, data: string) => TerminalOperationResult>> = vi.fn<(terminalId: string, data: string) => TerminalOperationResult>()

vi.mock('@/shell/edge/main/terminals/terminal-manager-instance', () => ({
    getTerminalManager: vi.fn(() => ({
        write: mockWrite
    }))
}))

import {sendTextToTerminal} from './send-text-to-terminal'

describe('sendTextToTerminal', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mockWrite.mockReset()
        mockWrite.mockReturnValue({success: true})
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('submits with ESC+CR after writing the message', async () => {
        const sendPromise: Promise<TerminalOperationResult> = sendTextToTerminal('test-terminal', 'hello')
        await vi.runAllTimersAsync()
        const result: TerminalOperationResult = await sendPromise

        expect(result).toEqual({success: true})

        const writes: string[] = mockWrite.mock.calls.map(([, data]) => data)
        expect(writes.slice(0, 4)).toEqual([' ', '\x1b', 'i', '\x15'])
        // Bracketed paste mode wraps message body, then dual submit
        expect(writes[4]).toBe('\x1b[200~')
        expect(writes[5]).toBe('hello')
        expect(writes[6]).toBe('\x1b[201~')
        expect(writes.slice(-2)).toEqual(['\x1b\r', '\r'])
    })

    it('returns first failed write result', async () => {
        mockWrite.mockImplementation((_terminalId: string, data: string): TerminalOperationResult => {
            if (data === 'hello') {
                return {success: false, error: 'write failed'}
            }
            return {success: true}
        })

        const sendPromise: Promise<TerminalOperationResult> = sendTextToTerminal('test-terminal', 'hello')
        await vi.runAllTimersAsync()
        const result: TerminalOperationResult = await sendPromise

        expect(result).toEqual({success: false, error: 'write failed'})
    })

    it('strips newlines from content before pasting', async () => {
        const sendPromise: Promise<TerminalOperationResult> = sendTextToTerminal('test-terminal', 'line one\nline two\nline three')
        await vi.runAllTimersAsync()
        const result: TerminalOperationResult = await sendPromise

        expect(result).toEqual({success: true})

        const writes: string[] = mockWrite.mock.calls.map(([, data]) => data)
        const pasteStart: number = writes.indexOf('\x1b[200~')
        const pasteEnd: number = writes.indexOf('\x1b[201~')
        expect(pasteStart).toBeGreaterThan(-1)
        expect(pasteEnd).toBeGreaterThan(pasteStart)
        // Newlines must be stripped — multi-line paste triggers "[N lines pasted]" collapse
        const content: string = writes.slice(pasteStart + 1, pasteEnd).join('')
        expect(content).not.toContain('\n')
        expect(content).toBe('line one line two line three')
    })

    it('serializes concurrent sends to the same terminal', async () => {
        const firstSend: Promise<TerminalOperationResult> = sendTextToTerminal('test-terminal', 'one')
        const secondSend: Promise<TerminalOperationResult> = sendTextToTerminal('test-terminal', 'two')

        await vi.runAllTimersAsync()

        const firstResult: TerminalOperationResult = await firstSend
        const secondResult: TerminalOperationResult = await secondSend
        expect(firstResult).toEqual({success: true})
        expect(secondResult).toEqual({success: true})

        const firstPayload: string[] = [' ', '\x1b', 'i', '\x15', '\x1b[200~', 'one', '\x1b[201~', '\x1b\r', '\r']
        const secondPayload: string[] = [' ', '\x1b', 'i', '\x15', '\x1b[200~', 'two', '\x1b[201~', '\x1b\r', '\r']
        const writes: string[] = mockWrite.mock.calls.map(([, data]) => data)

        expect(writes).toEqual([...firstPayload, ...secondPayload])
    })
})
