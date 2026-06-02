import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOneWayReplica,
  assertSessionAlive,
  buildReconcileCleanupScript,
  computeStaleWorktreeNames,
  localWorktreeName,
  parseRemoteWorktreeListing,
  parseSessionConnectivity,
  reconcileRemoteWorktrees,
  remoteWorktreeListingScript,
  repairRemoteWorktreeMetadataScript,
  remoteWorktreeGitEnvScript,
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
    () => assertOneWayReplica('vt-wts-synced', 'Synchronization mode: Default (Two Way Safe)\n'),
    /must be one-way-replica/,
  )
})

test('detects remote worktree roots from nested remote cwd under /root/vt-wts-synced/', () => {
  assert.equal(
    remoteWorktreeRoot('/root/vt-wts-synced/wt-one/webapp'),
    '/root/vt-wts-synced/wt-one',
  )
  assert.equal(remoteWorktreeRoot('/root/vtrepo-synced/webapp'), null)
  assert.equal(remoteWorktreeRoot('/root/vt-wts-synced'), null)
})

test('extracts local worktree name from nested cwd under vt-wts/', () => {
  assert.equal(
    localWorktreeName('/Users/x/repos/vt-wts/wt-one/webapp', '/Users/x/repos/vt-wts'),
    'wt-one',
  )
  assert.equal(localWorktreeName('/Users/x/repos/vtrepo/webapp', '/Users/x/repos/vt-wts'), null)
  assert.equal(localWorktreeName('/Users/x/repos/vt-wts', '/Users/x/repos/vt-wts'), null)
})

test('repairs remote worktree metadata for sibling-layout worktree commands', () => {
  const script = repairRemoteWorktreeMetadataScript('/root/vt-wts-synced/wt-one/webapp')
  assert.match(script, /repairing remote worktree git metadata/)
  // worktree-root .git file points up to the sibling main repo's admin dir
  assert.match(script, /gitdir: \.\.\/\.\.\/vtrepo-synced\/\.git\/worktrees\/wt-one/)
  // admin's gitdir points back across to the sibling vt-wts worktree
  assert.match(script, /\.\.\/\.\.\/\.\.\/\.\.\/vt-wts-synced\/wt-one\/\.git/)
  // commondir from admin to main .git stays `../..`
  assert.match(script, /'\.\.\/\.\.'/)
  // The repair is gated ONLY on the admin dir (synced by vt-remote). It must
  // NOT require the worktree `.git` pointer to pre-exist — that pointer is
  // sync-ignored by the vt-wts-synced session (machine-specific), so materializing it
  // when absent is the whole point of the repair.
  assert.match(script, /if \[ -d '[^']*\/\.git\/worktrees\/wt-one' \]; then/)
  assert.doesNotMatch(script, /-f '[^']*\/\.git'/)
  assert.equal(repairRemoteWorktreeMetadataScript('/root/vtrepo-synced/webapp'), ':')
})

test('exports GIT_DIR/GIT_COMMON_DIR for a worktree command, noop elsewhere', () => {
  const script = remoteWorktreeGitEnvScript('/root/vt-wts-synced/wt-one/webapp')
  // GIT_DIR points at the synced main repo's per-worktree admin dir (absolute,
  // so it survives the one-way mutagen replica reverting the `.git` pointer file).
  assert.match(script, /export GIT_COMMON_DIR='\/root\/vtrepo-synced\/\.git'/)
  assert.match(script, /GIT_DIR='\/root\/vtrepo-synced\/\.git\/worktrees\/wt-one'/)
  // Outside a worktree (the main checkout's real .git dir needs nothing): noop.
  assert.equal(remoteWorktreeGitEnvScript('/root/vtrepo-synced/webapp'), ':')
})

// --- Reconciler: stale-worktree drift cleanup ----------------------------

test('parses the remote worktree listing into git and wt sets', () => {
  const stdout = [
    '===GIT===',
    'wt-one',
    'wt-two',
    'wt-three',
    '===WT===',
    'wt-one',
    'wt-two',
    '',
  ].join('\n')
  assert.deepEqual(parseRemoteWorktreeListing(stdout), {
    git: ['wt-one', 'wt-two', 'wt-three'],
    wt: ['wt-one', 'wt-two'],
  })
})

test('parses an empty remote worktree listing as empty sets', () => {
  const stdout = ['===GIT===', '===WT===', ''].join('\n')
  assert.deepEqual(parseRemoteWorktreeListing(stdout), {git: [], wt: []})
})

test('returns empty sets when listing markers are missing', () => {
  assert.deepEqual(parseRemoteWorktreeListing('unexpected output'), {git: [], wt: []})
})

test('computes stale names as remote-minus-local, sorted', () => {
  assert.deepEqual(
    computeStaleWorktreeNames({
      localNames: ['wt-keep-a', 'wt-keep-b'],
      remoteNames: ['wt-keep-a', 'wt-stale-2', 'wt-stale-1', 'wt-keep-b'],
    }),
    ['wt-stale-1', 'wt-stale-2'],
  )
})

test('returns empty stale list when remote matches local', () => {
  assert.deepEqual(
    computeStaleWorktreeNames({
      localNames: ['wt-one', 'wt-two'],
      remoteNames: ['wt-two', 'wt-one'],
    }),
    [],
  )
})

test('builds a cleanup script joining .git/worktrees and synced sibling vt-wts targets', () => {
  const script = buildReconcileCleanupScript({
    staleGit: ['wt-a', 'wt-b'],
    staleWt: ['wt-a'],
    remoteRoot: '/root/vtrepo-synced',
    remoteWtsRoot: '/root/vt-wts-synced',
  })
  assert.match(script, /^rm -rf /)
  assert.match(script, /'\/root\/vtrepo-synced\/\.git\/worktrees\/wt-a'/)
  assert.match(script, /'\/root\/vtrepo-synced\/\.git\/worktrees\/wt-b'/)
  assert.match(script, /'\/root\/vt-wts-synced\/wt-a'/)
})

test('returns null cleanup script when nothing is stale', () => {
  assert.equal(
    buildReconcileCleanupScript({staleGit: [], staleWt: [], remoteRoot: '/r'}),
    null,
  )
})

test('rejects unsafe worktree names from cleanup script (defense in depth)', () => {
  assert.equal(
    buildReconcileCleanupScript({
      staleGit: ['$(reboot)', '../etc', '.', '..'],
      staleWt: ['name with space', 'a;b'],
      remoteRoot: '/r',
    }),
    null,
  )
})

test('remote listing script asks for both worktree dirs and tolerates missing dirs', () => {
  const script = remoteWorktreeListingScript({
    remoteRoot: '/root/vtrepo-synced',
    remoteWtsRoot: '/root/vt-wts-synced',
  })
  assert.match(script, /echo ===GIT===/)
  assert.match(script, /echo ===WT===/)
  assert.match(script, /ls -1 '\/root\/vtrepo-synced\/\.git\/worktrees' 2>\/dev\/null \|\| true/)
  assert.match(script, /ls -1 '\/root\/vt-wts-synced' 2>\/dev\/null \|\| true/)
})

// --- Reconciler orchestrator: integration with injected ssh boundary -----

const SILENT_LOG = () => {}

test('reconciler reports clean when remote has no extras', async () => {
  // Empty remote listing + empty local set (via a non-repo root) = no drift.
  const sshExec = async () => ['===GIT===', '===WT===', ''].join('\n')
  const result = await reconcileRemoteWorktrees({
    host: 'fake',
    repoRoot: '/nonexistent-repo-root',
    sshExec,
    log: SILENT_LOG,
  })
  assert.equal(result.status, 'clean')
})

test('reconciler issues cleanup script for stale remote dirs', async () => {
  const calls = []
  const sshExec = async (_host, script) => {
    calls.push(script)
    if (script.startsWith('rm -rf ')) return ''
    return ['===GIT===', 'wt-stale', '===WT===', 'wt-stale', ''].join('\n')
  }
  const result = await reconcileRemoteWorktrees({
    host: 'fake',
    repoRoot: '/nonexistent-repo-root',
    remoteRoot: '/root/vtrepo-synced',
    remoteWtsRoot: '/root/vt-wts-synced',
    sshExec,
    log: SILENT_LOG,
  })
  assert.equal(result.status, 'cleaned')
  assert.deepEqual(result.staleGit, ['wt-stale'])
  assert.deepEqual(result.staleWt, ['wt-stale'])
  assert.equal(calls.length, 2)
  assert.match(calls[1], /^rm -rf /)
  assert.match(calls[1], /'\/root\/vtrepo-synced\/\.git\/worktrees\/wt-stale'/)
  assert.match(calls[1], /'\/root\/vt-wts-synced\/wt-stale'/)
})

test('reconciler soft-fails when ssh listing throws', async () => {
  const sshExec = async () => {
    throw new Error('ssh: connect to host fake: Network is unreachable')
  }
  const result = await reconcileRemoteWorktrees({
    host: 'fake',
    repoRoot: process.cwd(),
    sshExec,
    log: SILENT_LOG,
  })
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'ssh-listing-failed')
})

test('reconciler soft-fails when ssh cleanup throws after a successful listing', async () => {
  const sshExec = async (_host, script) => {
    if (script.startsWith('rm -rf ')) throw new Error('ssh: remote rm -rf failed')
    return ['===GIT===', 'wt-stale', '===WT===', '', ''].join('\n')
  }
  const result = await reconcileRemoteWorktrees({
    host: 'fake',
    repoRoot: '/nonexistent-repo-root',
    sshExec,
    log: SILENT_LOG,
  })
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'ssh-cleanup-failed')
  assert.deepEqual(result.staleGit, ['wt-stale'])
})

// --- Session-alive gating (replaces waitMutagenIdle) ---------------------
//
// We no longer block on `Watching for changes`. Under multi-agent load that
// quiet window may never come, and `mutagen sync flush` drives the current
// pending cycle to completion regardless. The session-alive check now only
// asserts the session is usable: not paused, both endpoints connected.

const SAMPLE_HEALTHY_SESSION = `--------------------------------------------------------------------------------
Name: vt-remote
Configuration:
\tSynchronization mode: One Way Replica
Alpha:
\tURL: /Users/x/repo
\tConnected: Yes
\tSynchronizable contents:
\t\t100 directories
Beta:
\tURL: root@host:/root/repo
\tConnected: Yes
\tSynchronizable contents:
\t\t100 directories
Status: Staging files on beta
--------------------------------------------------------------------------------
`

const SAMPLE_PAUSED_SESSION = `Name: vt-remote
Alpha:
\tURL: /Users/x/repo
\tConnected: No
Beta:
\tURL: root@host:/root/repo
\tConnected: No
Status: [Paused]
`

const SAMPLE_BETA_DOWN_SESSION = `Name: vt-remote
Alpha:
\tURL: /Users/x/repo
\tConnected: Yes
Beta:
\tURL: root@host:/root/repo
\tConnected: No
Status: Connecting to beta
`

test('parses alpha/beta connectivity and status from session output', () => {
  const result = parseSessionConnectivity(SAMPLE_HEALTHY_SESSION)
  assert.equal(result.alpha, true)
  assert.equal(result.beta, true)
  assert.equal(result.status, 'Staging files on beta')
})

test('parses a paused session as disconnected', () => {
  const result = parseSessionConnectivity(SAMPLE_PAUSED_SESSION)
  assert.equal(result.alpha, false)
  assert.equal(result.beta, false)
  assert.equal(result.status, '[Paused]')
})

test('accepts a busy-but-connected session — does NOT require idle', () => {
  // The whole point of this change: `Staging files on beta` is fine. We do
  // not require `Watching for changes` because peer agents may keep it busy
  // indefinitely.
  assert.doesNotThrow(() => assertSessionAlive('vt-remote', SAMPLE_HEALTHY_SESSION))
})

test('rejects a paused session', () => {
  assert.throws(() => assertSessionAlive('vt-remote', SAMPLE_PAUSED_SESSION), /is paused/)
})

test('rejects a session with beta disconnected', () => {
  assert.throws(() => assertSessionAlive('vt-remote', SAMPLE_BETA_DOWN_SESSION), /endpoint\(s\) disconnected/)
})
