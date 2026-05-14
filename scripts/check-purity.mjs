#!/usr/bin/env node
// Records two purity health metrics from CodeQL queries:
//   - transitive-impurity-functions: count of functions reaching an impure sink
//   - transitive-impurity-ratio: max folder-level impure-reachable ratio

import {ensureDatabase, runQueryToRows, writeReport, nowIso} from './codeql-runner.mjs'

const REPORT_ONLY = process.argv.includes('--report-only')
const REBUILD = process.argv.includes('--rebuild-db')

// Defaults track current observed values (baseline ratchet — regressions fail).
const BUDGETS = {
    functions: Number(process.env.PURITY_FUNCTIONS_BUDGET ?? 312),
    ratio: Number(process.env.PURITY_RATIO_BUDGET ?? 1.0),
}

function main() {
    ensureDatabase({rebuild: REBUILD})

    console.log('▶ purity-reachability.ql')
    const reachRows = runQueryToRows('queries/purity-reachability.ql', '/tmp/purity-reachability.bqrs')
    console.log('▶ purity-by-folder.ql')
    const folderRows = runQueryToRows('queries/purity-by-folder.ql', '/tmp/purity-by-folder.bqrs')

    const functions = reachRows.map(r => ({
        file: r.path, line: Number(r.line), name: r.name, kind: r.kind,
    }))
    const directCount = functions.filter(fn => fn.kind === 'direct').length
    const transitiveCount = functions.filter(fn => fn.kind === 'transitive').length
    const totalImpure = functions.length

    const folders = folderRows
        .map(r => ({
            folder: r.folder,
            totalFunctions: Number(r.totalCount),
            impureFunctions: Number(r.impureCount),
            ratio: Number(r.ratio),
        }))
        .sort((a, b) => b.ratio - a.ratio || b.impureFunctions - a.impureFunctions)

    const maxRatio = folders.reduce((m, f) => Math.max(m, f.ratio), 0)

    writeReport({
        metricId: 'transitive-impurity-functions',
        metricName: 'Transitive Impurity (Functions)',
        description: 'Functions whose call graph transitively reaches an impure sink (fs/net/process).',
        category: 'Purity',
        current: totalImpure,
        budget: BUDGETS.functions,
        comparison: 'lte',
        passed: totalImpure <= BUDGETS.functions,
        unit: 'functions',
        timestamp: nowIso(),
        details: {
            directCount,
            transitiveCount,
            scope: 'packages/',
            topFunctions: functions.slice(0, 50),
        },
    })

    writeReport({
        metricId: 'transitive-impurity-ratio',
        metricName: 'Transitive Impurity Ratio (Max Folder)',
        description: 'Highest folder-level ratio of functions whose call graph reaches an impure sink.',
        category: 'Purity',
        current: Number(maxRatio.toFixed(4)),
        budget: BUDGETS.ratio,
        comparison: 'lte',
        passed: maxRatio <= BUDGETS.ratio,
        unit: 'ratio',
        timestamp: nowIso(),
        details: {
            folders: folders.slice(0, 50),
            folderCount: folders.length,
            scope: 'packages/',
        },
    })

    const failed = (totalImpure > BUDGETS.functions) || (maxRatio > BUDGETS.ratio)
    console.log(`✓ transitive impure functions = ${totalImpure} (budget ${BUDGETS.functions}, direct ${directCount} / transitive ${transitiveCount})`)
    console.log(`✓ max folder impurity ratio   = ${maxRatio.toFixed(4)} (budget ${BUDGETS.ratio.toFixed(4)})`)

    if (failed && !REPORT_ONLY) {
        console.error('✗ Purity health budget exceeded.')
        process.exit(1)
    }
}

main()
