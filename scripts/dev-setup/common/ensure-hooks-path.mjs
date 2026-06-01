#!/usr/bin/env node
// Pin git's core.hooksPath to `scripts/hooks` so the pre-push tier<=1 gate
// (capture-ci-checks --tier<=1, which includes tier-1-health) stays active.
//
// Runs from the root `postinstall`, so every `pnpm install` re-pins it. This is
// self-healing on purpose: we hit a case where core.hooksPath had been reset to
// the default (empty) `.git/hooks`, silently disabling the gate — so tier-1
// budget failures (coupling / fan-in) slipped through to the PR/CI layer instead
// of being caught locally before push.
//
// Idempotent (no-op when already correct) and never fails the install.

import { execFileSync } from 'node:child_process'

const DESIRED_HOOKS_PATH = 'scripts/hooks'

/** Pure: should we (re)write core.hooksPath? True unless it already equals the
 *  desired relative path. An empty/unset current value means "needs setting". */
export function needsHooksPathUpdate(current, desired = DESIRED_HOOKS_PATH) {
  return (current ?? '').trim() !== desired
}

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function main() {
  // Skip outside a work tree (e.g. a tarball/CI image install with no repo).
  try {
    gitOutput(['rev-parse', '--is-inside-work-tree'])
  } catch {
    return
  }

  let current = ''
  try {
    current = gitOutput(['config', '--get', 'core.hooksPath'])
  } catch {
    current = '' // unset → git exits non-zero
  }

  if (!needsHooksPathUpdate(current)) return

  try {
    execFileSync('git', ['config', 'core.hooksPath', DESIRED_HOOKS_PATH], { stdio: 'ignore' })
    process.stderr.write(`[ensure-hooks-path] pinned core.hooksPath = ${DESIRED_HOOKS_PATH} (was '${current || 'unset'}')\n`)
  } catch {
    // A hook-config nicety must never break the install.
  }
}

// Only run side effects when invoked directly (keeps the pure export testable).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
