#!/usr/bin/env node
// record-run — generic CI-check marker. Wraps any command:
//   - spawns it with inherited stdio (the dev sees output unchanged)
//   - measures wall-clock duration and exit code
//   - writes a CheckReport through recordCheckReport()
//   - re-exits with the child's exit code (transparent)
//
// Usage:
//   node --experimental-strip-types packages/measures/src/_runners/record-run.ts \
//     --id=npm-test --name="npm run test" --category=Command \
//     [--display="npm run test"] \
//     -- <command> [args...]
//
// Failures recording the CheckReport never change the exit code — observation
// must not alter behavior. Errors are surfaced to stderr instead.

import {spawn} from 'node:child_process'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {recordCheckReport} from '../_shared/writers/check-report-writer.ts'
import {vitestFailureDetailsForCommand} from './vitest-failure-detail-reader.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..')

function parseArgs(argv) {
    const opts = {id: null, name: null, category: null, display: null}
    let i = 0
    while (i < argv.length) {
        const arg = argv[i]
        if (arg === '--') { i++; break }
        const eq = arg.indexOf('=')
        const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
        const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i]
        if (key === 'id') opts.id = value
        else if (key === 'name') opts.name = value
        else if (key === 'category') opts.category = value
        else if (key === 'display') opts.display = value
        else { console.error(`record-run: unknown flag --${key}`); process.exit(64) }
        i++
    }
    const cmd = argv.slice(i)
    if (!opts.id || !opts.name || !opts.category || cmd.length === 0) {
        console.error('record-run: usage: --id=<id> --name=<name> --category=<cat> [--display=...] -- <command> [args...]')
        process.exit(64)
    }
    return {opts, cmd}
}

async function runChild(cmd) {
    const [bin, ...rest] = cmd
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()
    let stdoutBuf = ''
    let stderrBuf = ''
    const appendTail = (current, chunk) => `${current}${chunk}`.slice(-64_000)
    const result = await new Promise(resolve => {
        const child = spawn(bin, rest, {cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: false})
        child.stdout.on('data', chunk => {
            const text = chunk.toString('utf8')
            stdoutBuf = appendTail(stdoutBuf, text)
            process.stdout.write(chunk)
        })
        child.stderr.on('data', chunk => {
            const text = chunk.toString('utf8')
            stderrBuf = appendTail(stderrBuf, text)
            process.stderr.write(chunk)
        })
        child.on('error', err => resolve({code: -1, signal: null, spawnError: String(err?.message ?? err)}))
        child.on('close', (code, signal) => resolve({code, signal, spawnError: null}))
    })
    const endedAtMs = Date.now()
    const endedAt = new Date(endedAtMs).toISOString()
    return {startedAt, endedAt, durationMs: endedAtMs - startedAtMs, stdoutTail: summarizeTail(stdoutBuf), stderrTail: summarizeTail(stderrBuf), ...result}
}

function statusFor(exitCode, spawnError) {
    if (spawnError) return 'fail'
    return exitCode === 0 ? 'pass' : 'fail'
}

// Sized so a structured failure report (e.g. the BAR-bracketed "Refused: …"
// block emitted by the tier-0 gates) survives intact in the report's
// errorSummary instead of being clipped to just the trailing remediation lines.
function summarizeTail(text, maxLines = 200, maxChars = 16_000) {
    if (!text) return undefined
    const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
    let end = lines.length
    while (end > 0 && lines[end - 1] === '') end -= 1
    if (end === 0) return undefined
    const start = Math.max(0, end - maxLines)
    const joined = lines.slice(start, end).join('\n')
    return joined.length <= maxChars ? joined : joined.slice(-maxChars)
}

const {opts, cmd} = parseArgs(process.argv.slice(2))
const outcome = await runChild(cmd)
const status = statusFor(outcome.code, outcome.spawnError)
const display = opts.display ?? cmd.join(' ')
const failureDetails = status === 'fail'
    ? await vitestFailureDetailsForCommand(cmd, message => console.warn(message), `record-run:${opts.id}`)
    : {}

try {
    await recordCheckReport({
        checkId: opts.id,
        checkName: opts.name,
        category: opts.category,
        command: display,
        status,
        durationMs: outcome.durationMs,
        startedAt: outcome.startedAt,
        endedAt: outcome.endedAt,
        errorSummary: status === 'fail'
            ? (outcome.spawnError ?? outcome.stderrTail ?? outcome.stdoutTail ?? `exit ${outcome.code}${outcome.signal ? ` (${outcome.signal})` : ''}`)
            : undefined,
        timestamp: new Date().toISOString(),
        details: {
            exitCode: outcome.code ?? -1,
            ...(outcome.signal ? {signal: outcome.signal} : {}),
            ...(outcome.spawnError ? {spawnError: outcome.spawnError} : {}),
            ...failureDetails,
        },
    })
} catch (err) {
    console.error(`record-run: failed to record check '${opts.id}': ${err?.message ?? err}`)
}

process.exit(outcome.code ?? 1)
