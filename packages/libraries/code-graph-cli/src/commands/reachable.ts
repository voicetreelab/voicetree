/**
 * All transitively-reachable functions from `fnId` (the function's blast
 * radius). Excludes fnId itself.
 *
 * Memoised inside CallGraph.reachableFrom, so repeat calls are cheap.
 */
import type {CallGraph} from '../graph/load-graph.ts'
import {summarize, type FunctionSummary} from '../format/output.ts'
import {requireNode} from './_require-node.ts'

export function reachable(graph: CallGraph, fnId: string): readonly FunctionSummary[] {
    requireNode(graph, fnId)
    const ids = [...graph.reachableFrom(fnId)].sort()
    return ids
        .map(id => graph.nodes.get(id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map(summarize)
}
