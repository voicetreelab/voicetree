#!/usr/bin/env node
// Deps-freshness guard. Keeps `node_modules` consistent with the committed
// lockfile in whatever environment a command runs (Mac main checkout, the
// /root/vtrepo-synced replica, each vt-wts worktree, CI) — near-instant when
// fresh, a single `pnpm install --frozen-lockfile` only when the lockfile
// content actually changed since this env's last successful install.
//
// Why this exists: mutagen ignores `node_modules`, so a newly-added workspace
// dep (e.g. `@vt/perf-analysis`) ships its lockfile entry to every replica but
// the symlink is only created on the next `pnpm install` — and nothing forced
// that install. The stale link crashed the electron main on boot and timed out
// e2e-tier1. See ~/brain/mem/openspec/changes/dev-infra/deps-freshness-guard.
//
// Design (D2/D3): fingerprint = sha256 of pnpm-lock.yaml + pnpm-workspace.yaml
// CONTENT (mtime is unusable — mutagen posix-raw rewrites mtimes). Marker lives
// at <workspace-root>/node_modules/.vt-deps-fingerprint (per-env, gitignored,
// mutagen-ignored). Root is the nearest pnpm-workspace.yaml walking up from cwd,
// so the same script is correct in the main checkout and in every worktree.
//
// The guard is mutagen-agnostic (D7): it never waits for sync and never
// re-enters run-remote — the caller (run-remote) provides the settle
// precondition. It is idempotent, so being invoked twice (shim re-entry) is a
// harmless no-op.

import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const WORKSPACE_MANIFEST = 'pnpm-workspace.yaml'
const LOCKFILE = 'pnpm-lock.yaml'
const MARKER_NAME = '.vt-deps-fingerprint'
const FINGERPRINT_INPUTS = [LOCKFILE, WORKSPACE_MANIFEST]

// Nearest ancestor of `startDir` (inclusive) containing pnpm-workspace.yaml.
// Throws if none — the guard is meaningless outside a pnpm workspace.
function findWorkspaceRoot(startDir = process.cwd()) {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MANIFEST))) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`no ${WORKSPACE_MANIFEST} found walking up from ${startDir}`)
    }
    dir = parent
  }
}

// sha256 over the CONTENT of the lockfile + workspace manifest. A missing input
// contributes the empty string, so adding/removing a file also moves the hash.
function computeFingerprint(root) {
  const hash = createHash('sha256')
  for (const name of FINGERPRINT_INPUTS) {
    const p = join(root, name)
    hash.update(name)
    hash.update('\0')
    hash.update(existsSync(p) ? readFileSync(p) : Buffer.alloc(0))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function markerPath(root) {
  return join(root, 'node_modules', MARKER_NAME)
}

function readMarker(root) {
  const p = markerPath(root)
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null
}

// The black-box-testable decision (D8): deps are fresh iff a marker exists and
// records exactly the current lockfile fingerprint. Pure of any install side
// effect — tmp dir + lockfiles + marker fully determine the result.
function depsAreFresh(root) {
  return readMarker(root) === computeFingerprint(root)
}

// Stamp the marker with the current lockfile fingerprint, declaring "this env's
// node_modules is in sync with the committed lockfile". Called after any install
// path completes — both this guard's own install (below) and the worktree
// initial installer (install-worktree-deps.sh, via `--stamp`) — so the marker
// contract has a single source of truth and no installer can leave it unstamped.
function stampMarker(root) {
  const marker = markerPath(root)
  mkdirSync(dirname(marker), {recursive: true})
  writeFileSync(marker, computeFingerprint(root) + '\n')
  return marker
}

// The side effect: reconcile node_modules to the committed lockfile if (and
// only if) stale, then stamp the marker. Returns a small result object so
// callers/tests can observe what happened without scraping logs.
function ensureDepsFresh({startDir = process.cwd(), log = msg => process.stderr.write(msg)} = {}) {
  const root = findWorkspaceRoot(startDir)
  const fingerprint = computeFingerprint(root)
  if (readMarker(root) === fingerprint) {
    log(`[deps-guard] deps fresh (${root})\n`)
    return {root, fresh: true, installed: false}
  }

  log(`[deps-guard] lockfile changed — running 'pnpm install --frozen-lockfile' in ${root}\n`)
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    // Leave the marker untouched so the next invocation retries. Never run the
    // wrapped command on deps that failed to install.
    throw new Error(`pnpm install --frozen-lockfile failed (exit ${result.status}) in ${root}`)
  }

  stampMarker(root)
  log(`[deps-guard] deps installed; marker written (${root})\n`)
  return {root, fresh: false, installed: true}
}

// Stamp-only entrypoint: record the marker for an install another tool just
// performed, WITHOUT installing here. Used by install-worktree-deps.sh after its
// own `pnpm install --frozen-lockfile`, so the first later branch-switch/pull in
// a fresh worktree finds the marker fresh instead of triggering a redundant
// blocking reinstall. Returns the same result shape as ensureDepsFresh.
function stampDepsFresh({startDir = process.cwd(), log = msg => process.stderr.write(msg)} = {}) {
  const root = findWorkspaceRoot(startDir)
  stampMarker(root)
  log(`[deps-guard] marker stamped for existing install (${root})\n`)
  return {root, fresh: false, installed: false}
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  try {
    if (process.argv.includes('--stamp')) {
      stampDepsFresh()
    } else {
      ensureDepsFresh()
    }
  } catch (err) {
    process.stderr.write(`[deps-guard] ${err.message}\n`)
    process.exit(1)
  }
}

export {
  findWorkspaceRoot,
  computeFingerprint,
  markerPath,
  readMarker,
  depsAreFresh,
  ensureDepsFresh,
  stampMarker,
  stampDepsFresh,
}
