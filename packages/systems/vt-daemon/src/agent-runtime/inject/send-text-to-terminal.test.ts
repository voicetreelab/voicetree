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
