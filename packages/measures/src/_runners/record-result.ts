#!/usr/bin/env node
// record-result — record a pre-computed CheckReport. Sibling of record-run.ts.
// Use this when the work has already happened and you only want to file the
// result (e.g. from inside a Node hook that can't be wrapped externally).
//
// Usage:
//   node --experimental-strip-types packages/measures/src/_runners/record-result.ts \
//     --id=claude-stop-quality --name="Claude Stop hook" --category=Hook \
//     --status=pass|fail|skip --duration-ms=1234 \
//     [--display="..."] [--error-summary="..."] [--started-at=<iso>] [--ended-at=<iso>]

import {recordCheckReport} from '../_shared/writers/check-report-writer.ts'

function parseArgs(argv) {
    const opts = {
        id: null, name: null, category: null,
        status: null, durationMs: null,
        display: null, errorSummary: null,
        startedAt: null, endedAt: null,
    }
    let i = 0
    while (i < argv.length) {
        const arg = argv[i]
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
        else if (key === 'started-at') opts.startedAt = value
        else if (key === 'ended-at') opts.endedAt = value
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

// Default the timestamps to a span ending now of length durationMs, so callers
// that only know the duration still produce schema-valid reports.
const endedAt = opts.endedAt ?? new Date().toISOString()
const startedAt = opts.startedAt ?? new Date(Date.parse(endedAt) - opts.durationMs).toISOString()

try {
    await recordCheckReport({
        checkId: opts.id,
        checkName: opts.name,
        category: opts.category,
        command: opts.display ?? opts.name,
        status: opts.status,
        durationMs: opts.durationMs,
        startedAt,
        endedAt,
        errorSummary: opts.errorSummary || undefined,
        timestamp: new Date().toISOString(),
    })
} catch (err) {
    console.error(`record-result: ${err?.message ?? err}`)
    process.exit(1)
}
