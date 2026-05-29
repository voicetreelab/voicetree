#!/usr/bin/env node
/**
 * Synthetic concurrent fs.writeFile diagnostic — probes hypothesis #11
 * (and optionally #10) from packages/measures/perf/hypotheses.md.
 *
 * Question: under 15 in-process concurrent writers into a VT-shaped project
 * dir tree, does the bare `await fs.mkdir(...) + await fs.writeFile(...)`
 * pair degrade the same ~250x as the VT daemon's writeNodeToFile path?
 *
 * - If yes → degradation is purely OS/libuv/fs-side, VT code exonerated.
 * - If no  → some VT-specific contention (shared lock, scheduler quirk,
 *            apply-delta path) is implicated.
 *
 * Standalone — ZERO VT imports. Single Node process, multiple async
 * "workers" via Promise.all (mimics the daemon serving N concurrent HTTP
 * requests on one event loop).
 *
 * Usage:
 *   node packages/measures/perf/diagnose-concurrent-writes.mjs \
 *     --workers 15 --writes-per-worker 30 [--isolate-dirs] [--out PATH]
 */

import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const PHRASES = [
    'Working through the implementation details.',
    'Need to review the edge cases here.',
    'This connects to the broader architecture discussion.',
    'Performance considerations are important for this section.',
    'Iterating on the design based on feedback.',
    'The constraint solver needs careful tuning.',
    'Layout algorithm handles this via cola.js.',
    'File watcher integration is the critical path.',
]

function parseArgs(argv) {
    const args = {
        workers: 15,
        writesPerWorker: 30,
        isolateDirs: false,
        out: null,
    }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '--workers') args.workers = Number(argv[++i])
        else if (a === '--writes-per-worker') args.writesPerWorker = Number(argv[++i])
        else if (a === '--isolate-dirs') args.isolateDirs = true
        else if (a === '--out') args.out = argv[++i]
        else if (a === '--help' || a === '-h') {
            process.stdout.write(
                'usage: diagnose-concurrent-writes.mjs [--workers N] [--writes-per-worker M] [--isolate-dirs] [--out PATH]\n',
            )
            process.exit(0)
        } else {
            process.stderr.write(`unknown arg: ${a}\n`)
            process.exit(64)
        }
    }
    if (!Number.isFinite(args.workers) || args.workers < 1) {
        process.stderr.write('--workers must be a positive integer\n')
        process.exit(64)
    }
    if (!Number.isFinite(args.writesPerWorker) || args.writesPerWorker < 1) {
        process.stderr.write('--writes-per-worker must be a positive integer\n')
        process.exit(64)
    }
    return args
}

/**
 * Build the VT project subdir layout mirror — 8 clusters × 3 sub-subdirs
 * (planning/implementation/review), plus topics/topic-0..4, matching the
 * shape of generate-realistic-project.ts (read for reference, not imported).
 */
function buildSubdirs() {
    const dirs = []
    for (let c = 0; c < 8; c++) {
        const cluster = `cluster-${String.fromCharCode(97 + c)}`
        dirs.push(`${cluster}/planning`, `${cluster}/implementation`, `${cluster}/review`)
    }
    for (let f = 0; f < 5; f++) dirs.push(`topics/topic-${f}`)
    return dirs
}

function buildContent(id, idx) {
    const phrase = PHRASES[idx % PHRASES.length]
    const body =
        `---\nisContextNode: false\n---\n` +
        `# Node ${id}\n\n` +
        `This is ${id}. ${phrase}\n\n` +
        `-----------------\n_Links:_\n\n` +
        `[[node-${Math.max(0, idx - 1)}.md]]\n[[node-${Math.max(0, idx - 5)}.md]]\n`
    // Pad to ~500 bytes (VT realistic-project buildNodeContent is ~250-500B; we
    // pad to the high end so the syscall cost mirrors the worst case).
    const padTarget = 500
    const padding = body.length < padTarget ? ' '.padEnd(padTarget - body.length, '.') : ''
    return body + padding + '\n'
}

/**
 * Pre-create the entire project directory tree so mkdir-of-existing-dir is
 * what we measure (matches the VT daemon's post-#8-fix behavior, where
 * writeNodeToFile caches known-existing dirs).
 *
 * We DO still call mkdir({recursive:true}) per write — the timing measures
 * the no-op-mkdir cost, which is what the synthetic vs daemon comparison
 * needs to be apples-to-apples after the 56345ab8 mkdir cache landed.
 */
async function precreateTree(root, subdirs) {
    await fs.mkdir(root, { recursive: true })
    for (const d of subdirs) await fs.mkdir(join(root, d), { recursive: true })
}

function pickSubdir(subdirs, workerId, writeIdx) {
    // Spread writes across subdirs deterministically so the load looks like
    // the agent-storm: each agent walks the project, each write into a
    // different subdir. With 15 workers × ~29 subdirs the per-parent
    // contention is realistic.
    return subdirs[(workerId * 7 + writeIdx) % subdirs.length]
}

async function runWorker({ workerId, writesPerWorker, root, subdirs, isolateDirs, mkdirSamples, writeSamples, overallSamples }) {
    const workerSubdirs = isolateDirs
        ? [`worker-${workerId}/planning`, `worker-${workerId}/implementation`, `worker-${workerId}/review`]
        : subdirs
    if (isolateDirs) {
        for (const d of workerSubdirs) await fs.mkdir(join(root, d), { recursive: true })
    }
    for (let i = 0; i < writesPerWorker; i++) {
        const subdir = isolateDirs
            ? workerSubdirs[i % workerSubdirs.length]
            : pickSubdir(workerSubdirs, workerId, i)
        const dirAbs = join(root, subdir)
        const fileAbs = join(dirAbs, `w${workerId}-n${i}.md`)
        const content = buildContent(`w${workerId}-n${i}`, workerId * 1000 + i)

        const tStart = performance.now()
        await fs.mkdir(dirAbs, { recursive: true })
        const tAfterMkdir = performance.now()
        await fs.writeFile(fileAbs, content, 'utf8')
        const tEnd = performance.now()

        mkdirSamples.push(tAfterMkdir - tStart)
        writeSamples.push(tEnd - tAfterMkdir)
        overallSamples.push(tEnd - tStart)
    }
}

function percentile(samples, p) {
    if (samples.length === 0) return NaN
    const sorted = [...samples].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[idx]
}

function summarize(samples) {
    return {
        n: samples.length,
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        max: samples.length === 0 ? NaN : Math.max(...samples),
        mean: samples.length === 0 ? NaN : samples.reduce((a, b) => a + b, 0) / samples.length,
    }
}

function fmt(ms) {
    if (!Number.isFinite(ms)) return 'n/a'
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
    if (ms < 100) return `${ms.toFixed(2)}ms`
    return `${ms.toFixed(1)}ms`
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const root = await mkdtemp(join(tmpdir(), 'vt-diag-writes-'))
    const subdirs = buildSubdirs()

    try {
        if (!args.isolateDirs) await precreateTree(root, subdirs)

        const mkdirSamples = []
        const writeSamples = []
        const overallSamples = []

        const wallStart = performance.now()
        await Promise.all(
            Array.from({ length: args.workers }, (_, workerId) =>
                runWorker({
                    workerId,
                    writesPerWorker: args.writesPerWorker,
                    root,
                    subdirs,
                    isolateDirs: args.isolateDirs,
                    mkdirSamples,
                    writeSamples,
                    overallSamples,
                }),
            ),
        )
        const wallEnd = performance.now()
        const wallMs = wallEnd - wallStart
        const totalWrites = args.workers * args.writesPerWorker
        const throughput = (totalWrites / (wallMs / 1000)).toFixed(1)

        const result = {
            config: {
                workers: args.workers,
                writesPerWorker: args.writesPerWorker,
                isolateDirs: args.isolateDirs,
                root,
                totalWrites,
                nodeVersion: process.version,
                platform: process.platform,
            },
            wallMs,
            throughputWritesPerSec: Number(throughput),
            mkdir: summarize(mkdirSamples),
            writeFile: summarize(writeSamples),
            overall: summarize(overallSamples),
        }

        process.stdout.write(`\n=== diagnose-concurrent-writes ===\n`)
        process.stdout.write(`config:   workers=${args.workers} writesPerWorker=${args.writesPerWorker} isolateDirs=${args.isolateDirs}\n`)
        process.stdout.write(`platform: ${process.platform} node=${process.version}\n`)
        process.stdout.write(`root:     ${root}\n`)
        process.stdout.write(`wall:     ${fmt(wallMs)}  (${totalWrites} writes, ${throughput}/s)\n\n`)
        const rows = [
            ['mkdir   ', result.mkdir],
            ['writeFile', result.writeFile],
            ['overall  ', result.overall],
        ]
        process.stdout.write(`            n      p50        p95        max        mean\n`)
        for (const [label, s] of rows) {
            process.stdout.write(
                `${label}  ${String(s.n).padStart(5)}  ${fmt(s.p50).padEnd(9)}  ${fmt(s.p95).padEnd(9)}  ${fmt(s.max).padEnd(9)}  ${fmt(s.mean)}\n`,
            )
        }
        process.stdout.write(`\n`)

        if (args.out) {
            await fs.writeFile(args.out, JSON.stringify(result, null, 2), 'utf8')
            process.stdout.write(`wrote: ${args.out}\n`)
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

main().catch(err => {
    process.stderr.write(`[diagnose-concurrent-writes] ${err.stack || err.message}\n`)
    process.exit(1)
})
