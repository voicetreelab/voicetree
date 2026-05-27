import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOneWayReplica,
  ensureRemoteWorktreeReadyScript,
  localWorktreeName,
  repairRemoteWorktreeMetadataScript,
  refreshRemoteGitIndexScript,
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
  assert.doesNotThrow(() => assertOneWayReplica('vt-remote', 'Synchronization mode: One Way Replica\n'))
})

test('rejects bidirectional mutagen modes before remote execution', () => {
  assert.throws(
    () => assertOneWayReplica('vt-wts', 'Synchronization mode: Default (Two Way Safe)\n'),
    /must be one-way-replica/,
  )
})

test('refreshes the remote git index without touching the working tree', () => {
  assert.match(refreshRemoteGitIndexScript(), /git reset --mixed -q HEAD/)
})

test('detects remote worktree roots from nested remote cwd under /root/vt-wts/', () => {
  assert.equal(
    remoteWorktreeRoot('/root/vt-wts/wt-one/webapp'),
    '/root/vt-wts/wt-one',
  )
  assert.equal(remoteWorktreeRoot('/root/voicetree-public/webapp'), null)
  assert.equal(remoteWorktreeRoot('/root/vt-wts'), null)
})

test('extracts local worktree name from nested cwd under vt-wts/', () => {
  assert.equal(
    localWorktreeName('/Users/x/repos/vt-wts/wt-one/webapp', '/Users/x/repos/vt-wts'),
    'wt-one',
  )
  assert.equal(localWorktreeName('/Users/x/repos/voicetree-public/webapp', '/Users/x/repos/vt-wts'), null)
  assert.equal(localWorktreeName('/Users/x/repos/vt-wts', '/Users/x/repos/vt-wts'), null)
})

test('adds remote worktree readiness only for worktree commands', () => {
  assert.match(
    ensureRemoteWorktreeReadyScript('/root/vt-wts/wt-one/webapp'),
    /scripts\/git\/worktree\/ensure-ready\.mjs' '\/root\/vt-wts\/wt-one'/,
  )
  assert.equal(ensureRemoteWorktreeReadyScript('/root/voicetree-public/webapp'), ':')
})

test('repairs remote worktree metadata for sibling-layout worktree commands', () => {
  const script = repairRemoteWorktreeMetadataScript('/root/vt-wts/wt-one/webapp')
  assert.match(script, /repairing remote worktree git metadata/)
  // worktree-root .git file points up to the sibling main repo's admin dir
  assert.match(script, /gitdir: \.\.\/\.\.\/voicetree-public\/\.git\/worktrees\/wt-one/)
  // admin's gitdir points back across to the sibling vt-wts worktree
  assert.match(script, /\.\.\/\.\.\/\.\.\/\.\.\/vt-wts\/wt-one\/\.git/)
  // commondir from admin to main .git stays `../..`
  assert.match(script, /'\.\.\/\.\.'/)
  assert.equal(repairRemoteWorktreeMetadataScript('/root/voicetree-public/webapp'), ':')
})
