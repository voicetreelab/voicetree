#!/usr/bin/env node
// run-test-parallel — fan out the npm test lanes so they run concurrently.
//
// Today's `npm run test` chains: health → vite-build → native-rebuild → tier1
// → webapp-unit → tier2-browser. The only hard cross-lane edge is build →
// tier1. webapp-unit (vitest) and tier2-browser are independent.
//
// Two-phase topology (chosen for stability under typical local agent load):
//   Phase 1: Lane A (build → native-rebuild → tier1) || Lane B (vitest webapp-unit)
//   Phase 2: Lane C (tier2-browser) runs serially after Phase 1 completes.
//
// Why not all three in parallel? Lane C boots a Vite dev server and 5 chromium
// workers; when it competes with Phase-1 lanes for CPU, on-demand vite module
// compilation slows past playwright's 30s page.goto timeout and individual
// specs flake. A two-phase split keeps Phase 2 CPU-clean so the dev server
// pre-bundles fast and the chromium workers don't starve.
//
// Per-lane behavior:
//   - stdout/stderr stream to health-dashboard/reports/parallel-test-logs/<lane>.log
//   - mirrored to the parent terminal with a colored [lane] prefix
//   - within a phase: fail-fast — first non-zero exit SIGTERMs sibling lanes
//   - cross-phase: Phase 2 is skipped if Phase 1 failed (transparent exit code)
//   - the parent exits with the first non-zero lane exit code (0 if all pass)
//
// Each underlying lane script already records its own dashboard tile (via
// record-run.mjs or the vitest CI reporter), so no extra tile wiring here.
//
// Lanes are configurable via --lanes=A,B,C (default: all). Useful for inner
// loops that want to skip e.g. tier2-browser.

import {spawn} from 'node:child_process'
import {createWriteStream, mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const LOG_DIR = resolve(REPO_ROOT, 'health-dashboard', 'reports', 'parallel-test-logs')
mkdirSync(LOG_DIR, {recursive: true})

const COLORS = {
    A: '\x1b[36m', // cyan   — build + tier1 (critical path)
    B: '\x1b[33m', // yellow — webapp-unit vitest
    C: '\x1b[35m', // magenta — tier2-browser
    D: '\x1b[32m', // green  — health
}
const RESET = '\x1b[0m'

const PHASES = [
    {
        name: 'Phase 1: build+tier1 || vitest',
        lanes: [
            {id: 'A', label: 'build+tier1', cmd: 'npm', args: ['--workspace', 'webapp', 'run', 'test:e2e:tier1']},
            {id: 'B', label: 'webapp-unit', cmd: 'npm', args: ['--workspace', 'webapp', 'run', 'test:vitest:run']},
        ],
    },
    {
        name: 'Phase 2: tier2-browser (serial — needs clean CPU for vite dev)',
        lanes: [
            {id: 'C', label: 'tier2-browser', cmd: 'npm', args: ['--workspace', 'webapp', 'run', 'test:e2e:tier2:browser']},
        ],
    },
]

function parseLanesFilter(argv) {
    const flag = argv.find(a => a.startsWith('--lanes='))
    if (!flag) return null
    const ids = new Set(flag.slice('--lanes='.length).split(',').map(s => s.trim().toUpperCase()).filter(Boolean))
    return ids
}

function formatMs(ms) {
    const sec = ms / 1000
    if (sec < 60) return `${sec.toFixed(1)}s`
    const m = Math.floor(sec / 60)
    const s = sec - m * 60
    return `${m}m${s.toFixed(0).padStart(2, '0')}s`
}

function prefixWriter(stream, color, tag) {
    let leftover = ''
    return chunk => {
        const text = leftover + chunk.toString('utf8')
        const lines = text.split('\n')
        leftover = lines.pop() ?? ''
        for (const line of lines) {
            stream.write(`${color}[${tag}]${RESET} ${line}\n`)
        }
    }
}

function startLane(lane, killSignal) {
    const logPath = resolve(LOG_DIR, `${lane.id}-${lane.label}.log`)
    const logStream = createWriteStream(logPath, {flags: 'w'})
    logStream.write(`# lane ${lane.id} (${lane.label}) — ${lane.cmd} ${lane.args.join(' ')}\n# started ${new Date().toISOString()}\n\n`)

    const color = COLORS[lane.id] ?? ''
    const tag = `${lane.id} ${lane.label}`.padEnd(18)
    const toStdout = prefixWriter(process.stdout, color, tag)
    const toStderr = prefixWriter(process.stderr, color, tag)

    const child = spawn(lane.cmd, lane.args, {
        cwd: REPO_ROOT,
        env: {...process.env, ...(lane.env ?? {})},
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    })
    const startedAt = Date.now()

    child.stdout.on('data', chunk => {
        logStream.write(chunk)
        toStdout(chunk)
    })
    child.stderr.on('data', chunk => {
        logStream.write(chunk)
        toStderr(chunk)
    })

    const done = new Promise(resolveLane => {
        const onClose = (code, signal) => {
            const durationMs = Date.now() - startedAt
            logStream.end(`\n# exit ${code ?? 'null'}${signal ? ` (${signal})` : ''} after ${formatMs(durationMs)}\n`)
            resolveLane({code: code ?? -1, signal, durationMs})
        }
        child.on('error', err => onClose(-1, String(err?.message ?? err)))
        child.on('close', onClose)
    })

    return {lane, child, logPath, done, kill: () => { try { child.kill(killSignal) } catch {} }}
}

async function runPhase(phase) {
    console.log(`\n${phase.name}`)
    for (const lane of phase.lanes) {
        console.log(`  [${lane.id}] ${lane.label}  →  ${lane.cmd} ${lane.args.join(' ')}`)
        console.log(`         log: ${resolve(LOG_DIR, `${lane.id}-${lane.label}.log`)}`)
    }
    console.log('')

    const runners = phase.lanes.map(lane => startLane(lane, 'SIGTERM'))
    let firstFailure = null

    const watchers = runners.map(r => r.done.then(result => {
        if (result.code !== 0 && firstFailure === null) {
            firstFailure = {lane: r.lane, result}
            for (const other of runners) {
                if (other !== r) other.kill()
            }
        }
        return {lane: r.lane, result}
    }))

    const results = await Promise.all(watchers)
    return {results, firstFailure}
}

async function main() {
    const filter = parseLanesFilter(process.argv.slice(2))
    const phases = PHASES
        .map(phase => ({...phase, lanes: filter ? phase.lanes.filter(l => filter.has(l.id)) : phase.lanes}))
        .filter(phase => phase.lanes.length > 0)
    if (phases.length === 0) {
        console.error('run-test-parallel: no lanes selected')
        process.exit(64)
    }

    const wallStarted = Date.now()
    console.log(`run-test-parallel: ${phases.length} phase${phases.length === 1 ? '' : 's'}, ${phases.reduce((n, p) => n + p.lanes.length, 0)} lane${phases.reduce((n, p) => n + p.lanes.length, 0) === 1 ? '' : 's'} total`)

    const allResults = []
    let firstFailure = null
    for (const phase of phases) {
        const {results, firstFailure: phaseFailure} = await runPhase(phase)
        allResults.push(...results)
        if (phaseFailure && firstFailure === null) {
            firstFailure = phaseFailure
            console.log(`\nrun-test-parallel: phase failed — skipping remaining phases`)
            break
        }
    }
    const wallMs = Date.now() - wallStarted

    console.log('\n────────────────────────────────────────────────────────────')
    console.log('run-test-parallel: summary')
    for (const {lane, result} of allResults) {
        const color = COLORS[lane.id] ?? ''
        const ok = result.code === 0
        const status = ok ? `${color}PASS${RESET}` : `\x1b[31mFAIL${RESET}`
        console.log(`  [${lane.id}] ${lane.label.padEnd(14)} ${status}  ${formatMs(result.durationMs).padStart(7)}  exit=${result.code}${result.signal ? ` sig=${result.signal}` : ''}`)
    }
    console.log(`  wall-clock: ${formatMs(wallMs)}`)
    console.log('────────────────────────────────────────────────────────────\n')

    if (firstFailure) {
        process.exit(firstFailure.result.code === 0 ? 1 : firstFailure.result.code)
    }
    process.exit(0)
}

main().catch(err => {
    console.error(`run-test-parallel: unexpected error: ${err?.stack ?? err}`)
    process.exit(1)
})
