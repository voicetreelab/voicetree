import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOneWayReplica,
  ensureRemoteWorktreeReadyScript,
  localWorktreeRoot,
  repairRemoteWorktreeMetadataScript,
  remoteWorktreeRoot,
  synchronizationMode,
} from './run-remote.mjs'

test('parses the mutagen synchronization mode from list output', () => {
  const output = [
    'Configuration:',
    '\tSynchronization mode: One Way Replica',
    'Status: Watching for changes',
  ].join('\n')

  assert.equal(synchronizationMode(output), 'One Way Replica')
})

test('accepts one-way replica before remote execution', () => {
  assert.doesNotThrow(() => assertOneWayReplica('Synchronization mode: One Way Replica\n'))
})

test('rejects bidirectional mutagen modes before remote execution', () => {
  assert.throws(
    () => assertOneWayReplica('Synchronization mode: Default (Two Way Safe)\n'),
    /must be one-way-replica/,
  )
})

test('detects remote worktree roots from nested remote cwd', () => {
  assert.equal(
    remoteWorktreeRoot('/root/voicetree-public/.worktrees/wt-one/webapp'),
    '/root/voicetree-public/.worktrees/wt-one',
  )
  assert.equal(remoteWorktreeRoot('/root/voicetree-public/webapp'), null)
})

test('detects local worktree roots from nested cwd', () => {
  assert.equal(
    localWorktreeRoot('/repo/.worktrees/wt-one/webapp', '/repo'),
    '/repo/.worktrees/wt-one',
  )
  assert.equal(localWorktreeRoot('/repo/webapp', '/repo'), null)
})

test('adds remote worktree readiness only for worktree commands', () => {
  assert.match(
    ensureRemoteWorktreeReadyScript('/root/voicetree-public/.worktrees/wt-one/webapp'),
    /scripts\/git\/worktree\/ensure-ready\.mjs' '\/root\/voicetree-public\/\.worktrees\/wt-one'/,
  )
  assert.equal(ensureRemoteWorktreeReadyScript('/root/voicetree-public/webapp'), ':')
})

test('repairs remote worktree metadata only for worktree commands', () => {
  const script = repairRemoteWorktreeMetadataScript('/root/voicetree-public/.worktrees/wt-one/webapp')
  assert.match(script, /repairing remote worktree git metadata/)
  assert.match(script, /gitdir: \.\.\/\.\.\/\.git\/worktrees\/wt-one/)
  assert.match(script, /\.\.\/\.\.\/\.\.\/\.worktrees\/wt-one\/\.git/)
  assert.equal(repairRemoteWorktreeMetadataScript('/root/voicetree-public/webapp'), ':')
})
