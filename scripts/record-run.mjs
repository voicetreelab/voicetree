#!/usr/bin/env node
// record-run — generic CI-check marker. Wraps any command:
//   - spawns it with inherited stdio (the dev sees output unchanged)
//   - measures wall-clock duration and exit code
//   - writes a CheckReport through recordCheckReport()
//   - re-exits with the child's exit code (transparent)
//
// Usage:
//   node scripts/record-run.mjs \
//     --id=npm-test --name="npm run test" --category=Command \
//     [--display="npm run test"] [--slow] \
//     -- <command> [args...]
//
// Failures recording the CheckReport never change the exit code — observation
// must not alter behavior. Errors are surfaced to stderr instead.

import {spawn} from 'node:child_process'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {recordCheckReport} from '../packages/systems/_ci-check-writer.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

function parseArgs(argv) {
    const opts = {id: null, name: null, category: null, display: null, slow: false}
    let i = 0
    while (i < argv.length) {
        const arg = argv[i]
        if (arg === '--') { i++; break }
        if (arg === '--slow') { opts.slow = true; i++; continue }
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
        console.error('record-run: usage: --id=<id> --name=<name> --category=<cat> [--display=...] [--slow] -- <command> [args...]')
        process.exit(64)
    }
    return {opts, cmd}
}

async function runChild(cmd) {
    const [bin, ...rest] = cmd
    const startedAt = Date.now()
    let stdoutBuf = ''
    let stderrBuf = ''
    const appendTail = (current, chunk) => `${current}${chunk}`.slice(-8_000)
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
    return {durationMs: Date.now() - startedAt, stdoutTail: summarizeTail(stdoutBuf), stderrTail: summarizeTail(stderrBuf), ...result}
}

function statusFor(exitCode, spawnError) {
    if (spawnError) return 'fail'
    return exitCode === 0 ? 'pass' : 'fail'
}

function summarizeTail(text, maxLines = 4) {
    if (!text) return undefined
    const lines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(Boolean)
    if (lines.length === 0) return undefined
    return lines.slice(-maxLines).join('\n').slice(0, 800)
}

const {opts, cmd} = parseArgs(process.argv.slice(2))
const outcome = await runChild(cmd)
const status = statusFor(outcome.code, outcome.spawnError)
const display = opts.display ?? cmd.join(' ')

try {
    await recordCheckReport({
        checkId: opts.id,
        checkName: opts.name,
        category: opts.category,
        command: display,
        status,
        durationMs: outcome.durationMs,
        slow: opts.slow || undefined,
        errorSummary: status === 'fail'
            ? (outcome.spawnError ?? outcome.stderrTail ?? outcome.stdoutTail ?? `exit ${outcome.code}${outcome.signal ? ` (${outcome.signal})` : ''}`)
            : undefined,
        timestamp: new Date().toISOString(),
        details: {
            exitCode: outcome.code ?? -1,
            ...(outcome.signal ? {signal: outcome.signal} : {}),
            ...(outcome.spawnError ? {spawnError: outcome.spawnError} : {}),
        },
    })
} catch (err) {
    console.error(`record-run: failed to record check '${opts.id}': ${err?.message ?? err}`)
}

process.exit(outcome.code ?? 1)
