// Black-box test of the deps-freshness decision (D8). We exercise the public
// predicate against a real temp workspace — write lockfiles + a marker, assert
// fresh/stale. No pnpm is invoked: depsAreFresh is the install-free decision.
//
// Run dependency-free: `node --test ensure-deps-fresh.test.mjs`.

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  computeFingerprint,
  depsAreFresh,
  markerPath,
  findWorkspaceRoot,
  stampDepsFresh,
} from './ensure-deps-fresh.mjs'

// Build a throwaway workspace: pnpm-workspace.yaml + pnpm-lock.yaml, and
// optionally a marker. Returns the root path.
function makeWorkspace({lock = 'lockfile: 1\n', workspace = 'packages:\n  - a\n', marker} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deps-guard-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), workspace)
  writeFileSync(join(root, 'pnpm-lock.yaml'), lock)
  if (marker !== undefined) {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    writeFileSync(markerPath(root), marker)
  }
  return root
}

test('stale when the marker is missing (fresh env / first run)', () => {
  const root = makeWorkspace()
  try {
    assert.equal(depsAreFresh(root), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('fresh when the marker records the current fingerprint', () => {
  const root = makeWorkspace()
  try {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    writeFileSync(markerPath(root), computeFingerprint(root) + '\n')
    assert.equal(depsAreFresh(root), true)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('stale when lockfile content changes after the marker was written', () => {
  const root = makeWorkspace({lock: 'lockfile: 1\n'})
  try {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    writeFileSync(markerPath(root), computeFingerprint(root) + '\n')
    assert.equal(depsAreFresh(root), true)

    // A dependency edit rewrites the lockfile content → fingerprint moves.
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfile: 1\n  newdep: 2.0.0\n')
    assert.equal(depsAreFresh(root), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('stale when workspace manifest content changes', () => {
  const root = makeWorkspace({workspace: 'packages:\n  - a\n'})
  try {
    mkdirSync(join(root, 'node_modules'), {recursive: true})
    writeFileSync(markerPath(root), computeFingerprint(root) + '\n')
    assert.equal(depsAreFresh(root), true)

    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - a\n  - b\n')
    assert.equal(depsAreFresh(root), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('stale when the marker holds an unrelated value', () => {
  const root = makeWorkspace({marker: 'not-a-real-fingerprint\n'})
  try {
    assert.equal(depsAreFresh(root), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('stampDepsFresh makes a previously-stale workspace report fresh (no install)', () => {
  // Mirrors install-worktree-deps.sh: pnpm already installed the deps, then we
  // stamp the marker so the guard does not redundantly reinstall on the first
  // later branch-switch/pull.
  const root = makeWorkspace()
  try {
    assert.equal(depsAreFresh(root), false) // fresh worktree: no marker yet
    const result = stampDepsFresh({startDir: root, log: () => {}})
    assert.deepEqual(result, {root, fresh: false, installed: false})
    assert.equal(depsAreFresh(root), true) // marker now matches lockfile
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('stampDepsFresh re-stamps after a lockfile change so the guard tracks it', () => {
  const root = makeWorkspace({lock: 'lockfile: 1\n'})
  try {
    stampDepsFresh({startDir: root, log: () => {}})
    assert.equal(depsAreFresh(root), true)

    // Lockfile changes and a new install runs elsewhere; re-stamping realigns.
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfile: 1\n  newdep: 2.0.0\n')
    assert.equal(depsAreFresh(root), false)
    stampDepsFresh({startDir: root, log: () => {}})
    assert.equal(depsAreFresh(root), true)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('findWorkspaceRoot walks up from a nested subdirectory', () => {
  const root = makeWorkspace()
  try {
    const nested = join(root, 'packages', 'libraries', 'thing', 'src')
    mkdirSync(nested, {recursive: true})
    assert.equal(findWorkspaceRoot(nested), root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('findWorkspaceRoot throws outside any workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'no-workspace-'))
  try {
    assert.throws(() => findWorkspaceRoot(root), /no pnpm-workspace\.yaml/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
