import * as O from 'fp-ts/lib/Option.js'
import {describe, expect, it} from 'vitest'
import type {GraphDelta} from '@vt/graph-model/graph'
import {
    createOnNewNodeHookDeps,
    createOnNewNodeHookDispatcher,
} from './onNewNodeHook'

type TimerHandle = ReturnType<typeof setTimeout>

function newNodeDelta(path: string): GraphDelta {
    return [{
        type: 'UpsertNode',
        previousNode: O.none,
        nodeToUpsert: {absoluteFilePathIsID: path},
    }] as unknown as GraphDelta
}

function createManualTimers(): {
    readonly setTimer: (callback: () => void) => TimerHandle
    readonly clearTimer: (timer: TimerHandle) => void
    readonly flush: () => Promise<void>
} {
    const activeTimers: Map<TimerHandle, () => void> = new Map()

    return {
        setTimer: (callback: () => void): TimerHandle => {
            const timer: TimerHandle = {id: activeTimers.size + 1} as TimerHandle
            activeTimers.set(timer, callback)
            return timer
        },
        clearTimer: (timer: TimerHandle): void => {
            activeTimers.delete(timer)
        },
        flush: async (): Promise<void> => {
            const callbacks: readonly (() => void)[] = Array.from(activeTimers.values())
            activeTimers.clear()
            callbacks.forEach(callback => callback())
            await Promise.resolve()
            await Promise.resolve()
        },
    }
}

describe('createOnNewNodeHookDispatcher', () => {
    it('debounces duplicate node hook dispatches through observable writes', async () => {
        const manualTimers = createManualTimers()
        const writes: string[] = []
        const logs: string[] = []
        const dispatcher = createOnNewNodeHookDispatcher(createOnNewNodeHookDeps({
            setTimer: (callback: () => void, _delayMs: number): TimerHandle => manualTimers.setTimer(callback),
            clearTimer: manualTimers.clearTimer,
            ensureHookTerminal: async (): Promise<void> => undefined,
            writeToHookTerminal: (text: string): void => {
                writes.push(text)
            },
            quoteArg: (arg: string): string => `"${arg}"`,
        }))

        const delta = newNodeDelta('/vault/nodes/new-node.md')
        dispatcher(delta, 'run-hook', message => logs.push(message))
        dispatcher(delta, 'run-hook', message => logs.push(message))

        await manualTimers.flush()

        expect(writes).toEqual(['run-hook "/vault/nodes/new-node.md"'])
        expect(logs).toEqual(['[onNewNode] Dispatched hook for nodes/new-node.md'])
    })
})
