import {describe, expect, it} from 'vitest'
import {
    createSendTextToTerminal,
    type SendTextToTerminalDeps,
} from './send-text-to-terminal'

type Deferred<T> = {
    readonly promise: Promise<T>
    readonly resolve: (value: T | PromiseLike<T>) => void
    readonly reject: (reason?: unknown) => void
}

type WriteRecord = {
    readonly terminalId: string
    readonly bytes: string
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return {promise, resolve, reject}
}

describe('createSendTextToTerminal', () => {
    it('marks terminal input started before writing the injection bytes', async () => {
        const events: Array<{readonly type: 'mark' | 'write'; readonly terminalId: string; readonly value: string}> = []
        const sendTextToTerminal = createSendTextToTerminal()
        const deps: SendTextToTerminalDeps = {
            sleep: async (): Promise<void> => undefined,
            markInputStarted: (terminalId: string, inputText: string): void => {
                events.push({type: 'mark', terminalId, value: inputText})
            },
            writeLiteral: async (terminalId: string, bytes: string): Promise<void> => {
                events.push({type: 'write', terminalId, value: bytes})
            },
        }

        const result = await sendTextToTerminal('terminal-a', 'hello, terminal! 123', deps)

        expect(result).toEqual({success: true})
        expect(events[0]).toEqual({
            type: 'mark',
            terminalId: 'terminal-a',
            value: 'hello, terminal! 123',
        })
        expect(events.some(event => event.type === 'write')).toBe(true)
    })

    it('serializes concurrent writes to the same terminal through observable output order', async () => {
        const writes: WriteRecord[] = []
        const firstBodyWritten = deferred<void>()
        const releaseFirstBody = deferred<void>()
        const sendTextToTerminal = createSendTextToTerminal()
        const deps: SendTextToTerminalDeps = {
            sleep: async (): Promise<void> => undefined,
            writeLiteral: async (terminalId: string, bytes: string): Promise<void> => {
                writes.push({terminalId, bytes})
                if (terminalId === 'terminal-a' && bytes === 'first') {
                    firstBodyWritten.resolve(undefined)
                    await releaseFirstBody.promise
                }
            },
        }

        const first = sendTextToTerminal('terminal-a', 'first', deps)
        await firstBodyWritten.promise

        const writesBeforeSecond = writes.length
        const second = sendTextToTerminal('terminal-a', 'second', deps)
        await Promise.resolve()
        await Promise.resolve()

        expect(writes).toHaveLength(writesBeforeSecond)

        releaseFirstBody.resolve(undefined)
        const results = await Promise.all([first, second])

        const firstBodyIndex = writes.findIndex(write =>
            write.terminalId === 'terminal-a' && write.bytes === 'first'
        )
        const secondBodyIndex = writes.findIndex(write =>
            write.terminalId === 'terminal-a' && write.bytes === 'second'
        )

        expect(results).toEqual([{success: true}, {success: true}])
        expect(firstBodyIndex).toBeGreaterThanOrEqual(0)
        expect(secondBodyIndex).toBeGreaterThan(firstBodyIndex)
    })
})
