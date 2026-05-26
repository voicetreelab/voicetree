/**
 * Pretty-print workflow-duplicate pairs for console output. Mirrors
 * `format-duplicate-rows.ts` shape but adds DAG depth and edge-set
 * Jaccard so an operator can see why a pair scored where it did.
 */
import type {WorkflowEndpoint, WorkflowPair} from './cluster-call-dags'

function formatEndpoint(endpoint: WorkflowEndpoint): string {
    return `${endpoint.packageName}:${endpoint.file}:${endpoint.line} ${endpoint.name} [depth=${endpoint.dagDepth},edges=${endpoint.dagEdgeCount}]`
}

export function formatCallDagRows(pairs: readonly WorkflowPair[]): string {
    return pairs
        .map(pair => {
            const match = pair.exactMatch ? 'exact' : 'fuzzy'
            return `${formatEndpoint(pair.a)}  ↔  ${formatEndpoint(pair.b)}  score=${pair.score.toFixed(2)}  edgeJ=${pair.edgeSetJaccard.toFixed(2)}  match=${match}`
        })
        .join('\n')
}
