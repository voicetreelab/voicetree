import * as O from 'fp-ts/lib/Option.js'
import type {GraphDelta} from '@/pure/graph'
import {ensureHookTerminal, writeToHookTerminal} from '@/shell/edge/main/terminals/spawnHookTerminal'
import {shellQuote} from '@/shell/edge/main/worktree/gitWorktreeCommands'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'

/**
 * Fire the onNewNode hook for each genuinely new node in a delta.
 * Skips updates (previousNode is Some) and context-node artifacts.
 * Dispatches via persistent hook terminal instead of exec().
 * Fire-and-forget — never blocks the caller.
 */
export function dispatchOnNewNodeHooks(
    delta: GraphDelta,
    hookCommand: string
): void {
    for (const d of delta) {
        if (d.type === 'UpsertNode' && O.isNone(d.previousNode)) {
            const nodePath: string = d.nodeToUpsert.absoluteFilePathIsID
            if (!nodePath.includes('/ctx-nodes/')) {
                void ensureHookTerminal().then(() => {
                    writeToHookTerminal(`${hookCommand} ${shellQuote(nodePath)}`)
                    const shortPath: string = nodePath.split('/').slice(-2).join('/')
                    uiAPI.logHookResult(`[onNewNode] Dispatched hook for ${shortPath}`)
                }).catch((error: unknown) => {
                    const shortPath: string = nodePath.split('/').slice(-2).join('/')
                    const message: string = error instanceof Error ? error.message : String(error)
                    uiAPI.logHookResult(`[onNewNode] Hook FAILED for ${shortPath}: ${message}`)
                })
            }
        }
    }
}
