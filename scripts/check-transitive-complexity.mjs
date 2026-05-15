#!/usr/bin/env node
// Records two transitive-complexity health metrics from CodeQL queries:
//   - transitive-complexity-max: highest per-function transitive cyclomatic complexity
//     (catches "deep functions" hiding large total complexity in callees)
//   - transitive-complexity-folder-max: highest per-folder transitiveCx mean

import {ensureDatabase, runQueryToRows, writeReport, nowIso} from './codeql-runner.mjs'

const REPORT_ONLY = process.argv.includes('--report-only')
const REBUILD = process.argv.includes('--rebuild-db')

// Defaults track current observed values (baseline ratchet — regressions fail).
const BUDGETS = {
    maxFunction: Number(process.env.TCX_MAX_BUDGET ?? 1569),
    folderMean: Number(process.env.TCX_FOLDER_MEAN_BUDGET ?? 300),
}

function main() {
    ensureDatabase({rebuild: REBUILD})

    console.log('▶ transitive-complexity.ql')
    const fnRows = runQueryToRows('queries/transitive-complexity.ql', '/tmp/tcx.bqrs')
    console.log('▶ transitive-complexity-by-folder.ql')
    const folderRows = runQueryToRows('queries/transitive-complexity-by-folder.ql', '/tmp/tcxf.bqrs')

    const functions = fnRows
        .map(r => ({
            file: r.path,
            line: Number(r.line),
            name: r.name,
            directCx: Number(r.directCx),
            transitiveCx: Number(r.transitiveCx),
            calleeCount: Number(r.calleeCount),
        }))
        .sort((a, b) => b.transitiveCx - a.transitiveCx)

    const folders = folderRows
        .map(r => ({
            folder: r.folder,
            totalFunctions: Number(r.totalFunctions),
            maxTransitive: Number(r.maxTransitive),
            sumTransitive: Number(r.sumTransitive),
            meanTransitive: Number(r.meanTransitive),
        }))
        .sort((a, b) => b.meanTransitive - a.meanTransitive)

    const maxFunction = functions.length ? functions[0].transitiveCx : 0
    const folderMean = folders.length ? Math.max(...folders.map(f => f.meanTransitive)) : 0

    writeReport({
        metricId: 'transitive-complexity-max',
        metricName: 'Transitive Complexity (Max Function)',
        description: 'Highest per-function transitive cyclomatic complexity across the call graph.',
        category: 'Complexity',
        current: maxFunction,
        budget: BUDGETS.maxFunction,
        comparison: 'lte',
        passed: maxFunction <= BUDGETS.maxFunction,
        unit: 'complexity',
        timestamp: nowIso(),
        details: {
            functionCount: functions.length,
            scope: 'packages/',
            topFunctions: functions.slice(0, 50),
        },
    })

    writeReport({
        metricId: 'transitive-complexity-folder-mean-max',
        metricName: 'Transitive Complexity (Worst Folder Mean)',
        description: 'Highest per-folder mean transitive cyclomatic complexity; surfaces folders dense with deep orchestrators.',
        category: 'Complexity',
        current: Number(folderMean.toFixed(2)),
        budget: BUDGETS.folderMean,
        comparison: 'lte',
        passed: folderMean <= BUDGETS.folderMean,
        unit: 'complexity',
        timestamp: nowIso(),
        details: {
            folderCount: folders.length,
            scope: 'packages/',
            folders: folders.slice(0, 50),
        },
    })

    const failed = (maxFunction > BUDGETS.maxFunction) || (folderMean > BUDGETS.folderMean)
    console.log(`✓ max transitive complexity   = ${maxFunction} (budget ${BUDGETS.maxFunction})`)
    console.log(`✓ worst folder mean tcx       = ${folderMean.toFixed(2)} (budget ${BUDGETS.folderMean})`)

    if (failed && !REPORT_ONLY) {
        console.error('✗ Transitive complexity budget exceeded.')
        process.exit(1)
    }
}

main()
