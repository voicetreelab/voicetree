// Black-box regression test for the post-checkout deps-guard gate.
//
// The perf bug this guards against: `git worktree add` fires post-checkout
// synchronously *inside* the add. If the deps-guard runs a blocking
// `pnpm install` there, it stalls the caller — most visibly the VoiceTree app's
// spawn-in-worktree (~15s). Worktree creators that own the dependency lifecycle
// (the app, git-gate) set VT_GIT_GATE_SKIP_WORKTREE_PREWARM=1 and install deps
// off the critical path, so the hook must skip when that flag is set. A real
// `git switch` does NOT set the flag, so lockfile reconciliation on a branch
// switch is unaffected.
//
// We invoke the real hook with fake `git` + `node` on PATH and assert whether it
// reached the `node ensure-deps-fresh.mjs` step. Run: `node --test post-checkout.test.mjs`.

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'post-checkout')
const SHA_A = '1234567890abcdef1234567890abcdef12345678'
const SHA_B = 'abcdef1234567890abcdef1234567890abcdef12'

// Run the hook with $1/$2/$3 set and an optional extra env, behind fake `git`
// (reports a repo root) and a fake `node` that touches a sentinel when invoked.
// Returns true iff the hook reached the `node ensure-deps-fresh.mjs` step.
function guardWouldRun(prevHead, newHead, flag, extraEnv = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'post-checkout-'))
  try {
    const bin = join(sandbox, 'bin')
    mkdirSync(bin, {recursive: true})
    const sentinel = join(sandbox, 'guard-ran')
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho '${sandbox}'\n`)
    writeFileSync(join(bin, 'node'), `#!/bin/sh\necho ran > '${sentinel}'\n`)
    chmodSync(join(bin, 'git'), 0o755)
    chmodSync(join(bin, 'node'), 0o755)
    const result = spawnSync('bash', [HOOK, prevHead, newHead, flag], {
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`, ...extraEnv},
    })
    assert.equal(result.status, 0, `hook exited non-zero: ${result.stderr}`)
    return existsSync(sentinel)
  } finally {
    rmSync(sandbox, {recursive: true, force: true})
  }
}

test('SKIPS when VT_GIT_GATE_SKIP_WORKTREE_PREWARM=1 (caller owns deps lifecycle)', () => {
  assert.equal(guardWouldRun(SHA_A, SHA_B, '1', {VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '1'}), false)
})

test('RUNS on a normal branch switch (flag set, no prewarm-skip flag)', () => {
  assert.equal(guardWouldRun(SHA_A, SHA_B, '1'), true)
})

test('SKIPS a file checkout (flag 0 cannot change the lockfile)', () => {
  assert.equal(guardWouldRun(SHA_A, SHA_B, '0'), false)
})

test('a non-"1" value of the prewarm flag does NOT skip (only exact "1" opts out)', () => {
  assert.equal(guardWouldRun(SHA_A, SHA_B, '1', {VT_GIT_GATE_SKIP_WORKTREE_PREWARM: '0'}), true)
})
