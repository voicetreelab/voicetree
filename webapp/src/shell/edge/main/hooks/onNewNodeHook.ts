import * as O from 'fp-ts/lib/Option.js'
import type {GraphDelta} from '@/pure/graph'
import {ensureHookTerminal, writeToHookTerminal} from '@/shell/edge/main/terminals/spawnHookTerminal'
import {shellQuote} from '@/shell/edge/main/worktree/gitWorktreeCommands'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'

/**
 * Max new nodes per delta before hook dispatch is skipped.
 * Prevents hook spam from batch operations (MCP create_graph, wikilink resolution).
 * Individual FS events (1 node each) and small UI actions pass through normally.
 */
const MAX_NEW_NODES_PER_DELTA: number = 2

/**
 * Fire the onNewNode hook for each genuinely new node in a delta.
 * Skips updates (previousNode is Some) and context-node artifacts.
 * Skips entirely if the delta contains more than MAX_NEW_NODES_PER_DELTA new nodes
 * (likely a batch operation, not incremental user work).
 * Dispatches via persistent hook terminal instead of exec().
 * Fire-and-forget — never blocks the caller.
 */
export function dispatchOnNewNodeHooks(
    delta: GraphDelta,
    hookCommand: string
): void {
    // Collect genuinely new, non-context nodes
    const newNodePaths: readonly string[] = delta
        .filter(d => d.type === 'UpsertNode' && O.isNone(d.previousNode))
        .map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
        .filter(p => p !== '' && !p.includes('/ctx-nodes/'))

    if (newNodePaths.length > MAX_NEW_NODES_PER_DELTA) {
        uiAPI.logHookResult(
            `[onNewNode] Skipped hook: delta has ${newNodePaths.length} new nodes (max ${MAX_NEW_NODES_PER_DELTA})`
        )
        return
    }

    for (const nodePath of newNodePaths) {
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
