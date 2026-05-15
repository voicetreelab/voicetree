import * as O from 'fp-ts/lib/Option.js'
import type {GraphDelta} from '@vt/graph-model/graph'
import {ensureHookTerminal, writeToHookTerminal} from '../spawn/spawnHookTerminal'
import {shellQuote} from '../util/shellQuote'

export type HookResultLogger = (message: string) => void
export type OnNewNodeHookDeps = {
    readonly timers: Map<string, ReturnType<typeof setTimeout>>
    readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
    readonly ensureHookTerminal: () => Promise<void>
    readonly writeToHookTerminal: (text: string) => void
    readonly quoteArg: (arg: string) => string
}

/**
 * Max new nodes per delta before hook dispatch is skipped.
 * Prevents hook spam from batch operations (MCP create_graph, wikilink resolution).
 * Individual FS events (1 node each) and small UI actions pass through normally.
 */
const MAX_NEW_NODES_PER_DELTA: number = 2

/**
 * Debounce delay in ms before firing the hook.
 * macOS fires multiple FS events per file write (add + change, content + mtime).
 * The async yield in applyGraphDeltaToMemState allows concurrent events to both
 * produce previousNode=None deltas, causing duplicate dispatch.
 * Debouncing coalesces all events for the same path into a single hook fire.
 */
const DEBOUNCE_MS: number = 300

/** Pending debounce timers keyed by node path. */
const pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

const defaultOnNewNodeHookDeps: OnNewNodeHookDeps = {
    timers: pendingTimers,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ensureHookTerminal,
    writeToHookTerminal,
    quoteArg: shellQuote
}

export function getNewNodePathsForHook(delta: GraphDelta): readonly string[] {
    return delta
        .filter(d => d.type === 'UpsertNode' && O.isNone(d.previousNode))
        .map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
        .filter(p => p !== '' && !p.includes('/ctx-nodes/'))
}

export function formatHookCommand(hookCommand: string, nodePath: string, quoteArg: (arg: string) => string): string {
    return `${hookCommand} ${quoteArg(nodePath)}`
}

export function shortenNodePath(nodePath: string): string {
    return nodePath.split('/').slice(-2).join('/')
}

/**
 * Fire the onNewNode hook for each genuinely new node in a delta.
 * Skips updates (previousNode is Some) and context-node artifacts.
 * Skips entirely if the delta contains more than MAX_NEW_NODES_PER_DELTA new nodes
 * (likely a batch operation, not incremental user work).
 * Debounces per-path to coalesce duplicate FS events (macOS fires 2+ per write).
 * Dispatches via persistent hook terminal instead of exec().
 * Fire-and-forget — never blocks the caller.
 */
export function dispatchOnNewNodeHooks(
    delta: GraphDelta,
    hookCommand: string,
    logHookResult: HookResultLogger,
    deps: OnNewNodeHookDeps = defaultOnNewNodeHookDeps
): void {
    const newNodePaths: readonly string[] = getNewNodePathsForHook(delta)

    if (newNodePaths.length > MAX_NEW_NODES_PER_DELTA) {
        logHookResult(
            `[onNewNode] Skipped hook: delta has ${newNodePaths.length} new nodes (max ${MAX_NEW_NODES_PER_DELTA})`
        )
        return
    }

    for (const nodePath of newNodePaths) {
        // Cancel any existing timer for this path — restart the debounce window
        const existing: ReturnType<typeof setTimeout> | undefined = deps.timers.get(nodePath)
        if (existing) {
            deps.clearTimer(existing)
        }

        const timer: ReturnType<typeof setTimeout> = deps.setTimer(() => {
            deps.timers.delete(nodePath)

            void deps.ensureHookTerminal().then(() => {
                deps.writeToHookTerminal(formatHookCommand(hookCommand, nodePath, deps.quoteArg))
                const shortPath: string = shortenNodePath(nodePath)
                logHookResult(`[onNewNode] Dispatched hook for ${shortPath}`)
            }).catch((error: unknown) => {
                const shortPath: string = shortenNodePath(nodePath)
                const message: string = error instanceof Error ? error.message : String(error)
                logHookResult(`[onNewNode] Hook FAILED for ${shortPath}: ${message}`)
            })
        }, DEBOUNCE_MS)

        deps.timers.set(nodePath, timer)
    }
}
