import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'

import {
  dependencyFingerprint,
  ensureWorktreeReady,
  mainRepoFromPath,
  markerPath,
  sourceDependencyCopyBlockReason,
  sourceSeedBlockReason,
} from './ensure-ready.mjs'

function writeDependencyFiles(root, lockText = 'same-lock') {
  mkdirSync(join(root, 'webapp'), {recursive: true})
  mkdirSync(join(root, 'packages', 'libraries', 'graph-model'), {recursive: true})
  writeFileSync(join(root, 'package.json'), '{"workspaces":["webapp","packages/libraries/*"]}\n')
  writeFileSync(join(root, 'package-lock.json'), `${lockText}\n`)
  writeFileSync(join(root, 'webapp', 'package.json'), '{"name":"webapp"}\n')
  writeFileSync(
    join(root, 'packages', 'libraries', 'graph-model', 'package.json'),
    '{"name":"@vt/graph-model"}\n',
  )
}

function seedSourceNodeModules(sourceRoot) {
  mkdirSync(join(sourceRoot, 'node_modules', '@vt'), {recursive: true})
  mkdirSync(join(sourceRoot, 'webapp', 'node_modules', 'vite'), {recursive: true})
  writeFileSync(join(sourceRoot, 'webapp', 'node_modules', 'vite', 'index.js'), 'export {}\n')
  symlinkSync('../../packages/local-pkg', join(sourceRoot, 'node_modules', '@vt', 'local-pkg'))
}

test('resolves the main repo from a sibling vt-wts path without git metadata', () => {
  assert.equal(
    mainRepoFromPath('/tmp/example/vt-wts/wt-one'),
    '/tmp/example/voicetree-public',
  )
})

test('copies main node_modules into a matching worktree and keeps @vt links local', () => {
  const parent = mkdtempSync(join(tmpdir(), 'vt-worktree-ready-'))
  const repoRoot = join(parent, 'voicetree-public')
  mkdirSync(repoRoot, {recursive: true})
  const worktreeRoot = join(parent, 'vt-wts', 'wt-one')

  writeDependencyFiles(repoRoot)
  writeDependencyFiles(worktreeRoot)
  const realWorktreeRoot = realpathSync(worktreeRoot)
  mkdirSync(join(worktreeRoot, 'packages', 'local-pkg'), {recursive: true})
  seedSourceNodeModules(repoRoot)

  const result = ensureWorktreeReady(worktreeRoot, {
    installDependencies() {
      throw new Error('npm install should not run when source node_modules matches')
    },
    log() {},
  })

  assert.equal(result.status, 'seeded')
  assert.ok(existsSync(join(worktreeRoot, 'webapp', 'node_modules', 'vite', 'index.js')))
  assert.equal(
    realpathSync(join(worktreeRoot, 'node_modules', '@vt', 'local-pkg')),
    join(realWorktreeRoot, 'packages', 'local-pkg'),
  )
  assert.equal(
    JSON.parse(readFileSync(markerPath(worktreeRoot), 'utf8')).dependencyFingerprint,
    dependencyFingerprint(worktreeRoot),
  )
})

test('copies first and runs npm install when dependency fingerprints differ', () => {
  const parent = mkdtempSync(join(tmpdir(), 'vt-worktree-ready-'))
  const repoRoot = join(parent, 'voicetree-public')
  mkdirSync(repoRoot, {recursive: true})
  const worktreeRoot = join(parent, 'vt-wts', 'wt-two')

  writeDependencyFiles(repoRoot, 'main-lock')
  writeDependencyFiles(worktreeRoot, 'worktree-lock')
  const realWorktreeRoot = realpathSync(worktreeRoot)
  mkdirSync(join(worktreeRoot, 'packages', 'local-pkg'), {recursive: true})
  seedSourceNodeModules(repoRoot)

  let installedAt = ''
  const result = ensureWorktreeReady(worktreeRoot, {
    installDependencies(targetRoot) {
      installedAt = targetRoot
      mkdirSync(join(targetRoot, 'node_modules'), {recursive: true})
      mkdirSync(join(targetRoot, 'webapp', 'node_modules'), {recursive: true})
    },
    log() {},
  })

  assert.equal(result.status, 'reconciled')
  assert.equal(installedAt, realWorktreeRoot)
  assert.ok(existsSync(join(worktreeRoot, 'webapp', 'node_modules', 'vite', 'index.js')))
  assert.ok(existsSync(markerPath(worktreeRoot)))
})

test('explains why source node_modules cannot seed a worktree', () => {
  const parent = mkdtempSync(join(tmpdir(), 'vt-worktree-ready-'))
  const repoRoot = join(parent, 'voicetree-public')
  mkdirSync(repoRoot, {recursive: true})
  const worktreeRoot = join(parent, 'vt-wts', 'wt-three')

  writeDependencyFiles(repoRoot, 'main-lock')
  writeDependencyFiles(worktreeRoot, 'worktree-lock')
  seedSourceNodeModules(repoRoot)

  assert.equal(
    sourceSeedBlockReason({
      sourceRoot: repoRoot,
      targetRoot: worktreeRoot,
      targetFingerprint: dependencyFingerprint(worktreeRoot),
    }),
    'dependency inputs differ between source and worktree',
  )
  assert.equal(
    sourceDependencyCopyBlockReason({
      sourceRoot: repoRoot,
      targetRoot: worktreeRoot,
    }),
    null,
  )
})
