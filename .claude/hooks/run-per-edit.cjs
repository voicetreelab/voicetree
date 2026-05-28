#!/usr/bin/env node
// Thin dispatcher for the Claude/Codex PostToolUse hook. Forwards the
// tool envelope on stdin to packages/measures/src/_runners/per-edit-hook.ts
// via `node --experimental-strip-types`, propagating its exit code so
// the hook contract (exit 2 → block agent) is preserved.
//
// All discovery + measure execution lives in the TS runner. This file
// exists only because Claude/Codex hook configs invoke `node <path>` and
// that path must be a JS/CJS file the runtime can load without a flag.

const {spawnSync} = require('node:child_process')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const RUNNER = path.join(REPO_ROOT, 'packages/measures/src/_runners/per-edit-hook.ts')

async function main() {
    let stdinData = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) stdinData += chunk
    const result = spawnSync('node', [
        '--no-warnings=ExperimentalWarning',
        '--experimental-strip-types',
        RUNNER,
    ], {input: stdinData, stdio: ['pipe', 'inherit', 'inherit']})
    process.exit(result.status ?? 0)
}

main().catch(() => process.exit(0))
