/**
 * Pretty-print duplicate pairs for console output.
 *
 * The same `(packageA:fileA:lineA nameA ↔ packageB:fileB:lineB nameB
 * score=X.XX signals=...)` form the deliverable spec calls for.
 */
import type {DuplicatePair, SignalName} from './cluster-duplicates'

function shortSignals(signals: readonly SignalName[]): string {
    return signals.map(signal => {
        if (signal === 'structural') return 'struct'
        if (signal === 'lexical') return 'lex'
        return 'beh'
    }).join('+')
}

function formatEndpoint(endpoint: DuplicatePair['a']): string {
    return `${endpoint.packageName}:${endpoint.file}:${endpoint.line} ${endpoint.name}`
}

export function formatDuplicateRows(pairs: readonly DuplicatePair[]): string {
    return pairs
        .map(pair => `${formatEndpoint(pair.a)}  ↔  ${formatEndpoint(pair.b)}  score=${pair.score.toFixed(2)}  signals=${shortSignals(pair.signalsMatched)}`)
        .join('\n')
}
