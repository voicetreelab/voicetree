import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOneWayReplica,
  refreshRemoteGitIndexScript,
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

test('refreshes the remote git index without touching the working tree', () => {
  assert.match(refreshRemoteGitIndexScript(), /git reset --mixed -q HEAD/)
})
