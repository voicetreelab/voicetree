#!/usr/bin/env node
// record-result — record a pre-computed CheckReport. Sibling of record-run.mjs.
// Use this when the work has already happened and you only want to file the
// result (e.g. from inside a Node hook that can't be wrapped externally).
//
// Usage:
//   node scripts/record-result.mjs \
//     --id=claude-stop-quality --name="Claude Stop hook" --category=Hook \
//     --status=pass|fail|skip --duration-ms=1234 \
//     [--display="..."] [--error-summary="..."] [--slow]

import {recordCheckReport} from '../packages/systems/_ci-check-writer.ts'

function parseArgs(argv) {
    const opts = {
        id: null, name: null, category: null,
        status: null, durationMs: null,
        display: null, errorSummary: null, slow: false,
    }
    let i = 0
    while (i < argv.length) {
        const arg = argv[i]
        if (arg === '--slow') { opts.slow = true; i++; continue }
        const eq = arg.indexOf('=')
        const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
        const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i]
        if (key === 'id') opts.id = value
        else if (key === 'name') opts.name = value
        else if (key === 'category') opts.category = value
        else if (key === 'status') opts.status = value
        else if (key === 'duration-ms') opts.durationMs = Number(value)
        else if (key === 'display') opts.display = value
        else if (key === 'error-summary') opts.errorSummary = value
        else { console.error(`record-result: unknown flag --${key}`); process.exit(64) }
        i++
    }
    const missing = ['id', 'name', 'category', 'status', 'durationMs'].filter(k => opts[k] == null || opts[k] === '')
    if (missing.length > 0) {
        console.error(`record-result: missing required: ${missing.join(', ')}`)
        process.exit(64)
    }
    return opts
}

const opts = parseArgs(process.argv.slice(2))

try {
    await recordCheckReport({
        checkId: opts.id,
        checkName: opts.name,
        category: opts.category,
        command: opts.display ?? opts.name,
        status: opts.status,
        durationMs: opts.durationMs,
        slow: opts.slow || undefined,
        errorSummary: opts.errorSummary || undefined,
        timestamp: new Date().toISOString(),
    })
} catch (err) {
    console.error(`record-result: ${err?.message ?? err}`)
    process.exit(1)
}
