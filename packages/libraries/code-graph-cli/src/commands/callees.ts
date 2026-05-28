/**
 * Direct callees of `fnId` — the functions this function calls.
 *
 * Excludes self-calls (recursion). See callers.ts for fnId format.
 */
import type {CallGraph} from '../graph/load-graph.ts'
import {summarize, type FunctionSummary} from '../format/output.ts'
import {requireNode} from './_require-node.ts'

export function callees(graph: CallGraph, fnId: string): readonly FunctionSummary[] {
    requireNode(graph, fnId)
    const ids = [...graph.callees(fnId)].sort()
    return ids
        .map(id => graph.nodes.get(id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map(summarize)
}
