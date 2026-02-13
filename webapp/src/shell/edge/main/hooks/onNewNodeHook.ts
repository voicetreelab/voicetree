import * as O from 'fp-ts/lib/Option.js'
import type {GraphDelta} from '@/pure/graph'
import {runHook} from '@/shell/edge/main/worktree/gitWorktreeCommands'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'

/**
 * Fire the onNewNode hook for each genuinely new node in a delta.
 * Skips updates (previousNode is Some) and context-node artifacts.
 * Fire-and-forget — never blocks the caller.
 * Logs success/failure to the renderer dev console via uiAPI.
 */
export function dispatchOnNewNodeHooks(
    delta: GraphDelta,
    hookCommand: string,
    repoRoot: string
): void {
    for (const d of delta) {
        if (d.type === 'UpsertNode' && O.isNone(d.previousNode)) {
            const nodePath: string = d.nodeToUpsert.absoluteFilePathIsID
            if (!nodePath.includes('/ctx-nodes/')) {
                void runHook(hookCommand, [nodePath], repoRoot).then(result => {
                    const shortPath: string = nodePath.split('/').slice(-2).join('/')
                    if (result.success) {
                        uiAPI.logHookResult(`[onNewNode] Hook succeeded for ${shortPath}`)
                    } else {
                        uiAPI.logHookResult(`[onNewNode] Hook FAILED for ${shortPath}: ${result.error}`)
                    }
                    if (result.stderr) {
                        uiAPI.logHookResult(`[onNewNode] stderr: ${result.stderr.trimEnd()}`)
                    }
                })
            }
        }
    }
}
