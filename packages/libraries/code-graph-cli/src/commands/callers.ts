/**
 * Direct callers of `fnId`.
 *
 * fnId format: `file:line:name` — same id the call graph emits, also what
 * find-symbol returns. If multiple functions share a name, the file:line
 * prefix disambiguates.
 *
 * Throws if fnId is not in the graph (vs. silently returning [], which
 * would be indistinguishable from "no callers").
 */
import type {CallGraph} from '../graph/load-graph.ts'
import {summarize, type FunctionSummary} from '../format/output.ts'
import {requireNode} from './_require-node.ts'

export function callers(graph: CallGraph, fnId: string): readonly FunctionSummary[] {
    requireNode(graph, fnId)
    const ids = [...graph.callers(fnId)].sort()
    return ids
        .map(id => graph.nodes.get(id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map(summarize)
}
