#!/usr/bin/env node
// Records semantic coupling between top-level VT packages from a CodeQL query.
// Weight = distinct cross-package callees + distinct named import bindings.
//
// Distinguishes from boolean import-count coupling: `import {a,b,c}` from another
// package contributes weight 3, not 1; calls of N distinct functions add N.

import {ensureDatabase, runQueryToRows, writeReport, nowIso} from './codeql-runner.mjs'

const REPORT_ONLY = process.argv.includes('--report-only')
const REBUILD = process.argv.includes('--rebuild-db')

// Defaults track current observed values (baseline ratchet — regressions fail).
const BUDGETS = {
    maxPairWeight: Number(process.env.SC_MAX_PAIR_BUDGET ?? 110),
    maxOutDegree: Number(process.env.SC_MAX_OUTDEGREE_BUDGET ?? 154),
}

function main() {
    ensureDatabase({rebuild: REBUILD})

    console.log('▶ semantic-coupling.ql')
    const rows = runQueryToRows('queries/semantic-coupling.ql', '/tmp/sc.bqrs')

    const pairs = rows
        .map(r => ({
            src: r.src,
            tgt: r.tgt,
            callEdges: Number(r.callEdges),
            importBindings: Number(r.importBindings),
            weight: Number(r.weight),
        }))
        .sort((a, b) => b.weight - a.weight)

    const outDegree = new Map()
    const inDegree = new Map()
    for (const p of pairs) {
        outDegree.set(p.src, (outDegree.get(p.src) ?? 0) + p.weight)
        inDegree.set(p.tgt, (inDegree.get(p.tgt) ?? 0) + p.weight)
    }
    const packages = [...new Set([...outDegree.keys(), ...inDegree.keys()])]
        .map(pkg => ({
            package: pkg,
            outWeight: outDegree.get(pkg) ?? 0,
            inWeight: inDegree.get(pkg) ?? 0,
        }))
        .sort((a, b) => b.outWeight - a.outWeight)

    const maxPair = pairs.length ? pairs[0].weight : 0
    const maxOut = packages.length ? packages[0].outWeight : 0

    writeReport({
        metricId: 'semantic-coupling-max-pair',
        metricName: 'Semantic Coupling (Strongest Pair)',
        description: 'Highest weighted package-pair coupling: distinct cross-package callees + named import bindings.',
        category: 'Coupling',
        current: maxPair,
        budget: BUDGETS.maxPairWeight,
        comparison: 'lte',
        passed: maxPair <= BUDGETS.maxPairWeight,
        unit: 'symbols',
        timestamp: nowIso(),
        details: {
            pairCount: pairs.length,
            scope: 'packages/{libraries,systems}/*',
            pairs,
        },
    })

    writeReport({
        metricId: 'semantic-coupling-max-out',
        metricName: 'Semantic Coupling (Worst Out-Degree)',
        description: 'Highest per-package semantic out-weight: distinct symbols this package consumes from others.',
        category: 'Coupling',
        current: maxOut,
        budget: BUDGETS.maxOutDegree,
        comparison: 'lte',
        passed: maxOut <= BUDGETS.maxOutDegree,
        unit: 'symbols',
        timestamp: nowIso(),
        details: {
            packageCount: packages.length,
            scope: 'packages/{libraries,systems}/*',
            packages,
        },
    })

    const failed = (maxPair > BUDGETS.maxPairWeight) || (maxOut > BUDGETS.maxOutDegree)
    console.log(`✓ max pair weight             = ${maxPair} (budget ${BUDGETS.maxPairWeight})`)
    console.log(`✓ max out-degree              = ${maxOut} (budget ${BUDGETS.maxOutDegree})`)

    if (failed && !REPORT_ONLY) {
        console.error('✗ Semantic coupling budget exceeded.')
        process.exit(1)
    }
}

main()
