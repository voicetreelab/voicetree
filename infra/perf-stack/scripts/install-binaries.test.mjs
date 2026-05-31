import test from 'node:test'
import assert from 'node:assert/strict'

import { parseGoVersion, versionGte } from './install-binaries.mjs'

test('parseGoVersion extracts the [major, minor, patch] triple from `go version` output', () => {
  assert.deepEqual(parseGoVersion('go version go1.20.1 darwin/arm64'), [1, 20, 1])
  assert.deepEqual(parseGoVersion('go version go1.26.3 linux/amd64'), [1, 26, 3])
})

test('parseGoVersion treats an absent patch as 0', () => {
  assert.deepEqual(parseGoVersion('go version go1.21 linux/amd64'), [1, 21, 0])
})

test('parseGoVersion returns null for unrecognized / empty output', () => {
  assert.equal(parseGoVersion('command not found: go'), null)
  assert.equal(parseGoVersion(''), null)
  assert.equal(parseGoVersion(undefined), null)
})

test('versionGte compares major, then minor, then patch', () => {
  assert.equal(versionGte([1, 21, 0], [1, 21, 0]), true, 'equal counts as >=')
  // The exact failure that bit: Go 1.20.1 is below the 1.21 GOTOOLCHAIN floor.
  assert.equal(versionGte([1, 20, 1], [1, 21, 0]), false, 'older minor is below the floor')
  assert.equal(versionGte([1, 26, 3], [1, 21, 0]), true, 'newer minor clears the floor')
  assert.equal(versionGte([2, 0, 0], [1, 21, 0]), true, 'newer major clears the floor')
  assert.equal(versionGte([1, 21, 2], [1, 21, 1]), true, 'patch breaks the tie when major+minor match')
  assert.equal(versionGte([1, 21, 0], [1, 21, 1]), false, 'lower patch is below when major+minor match')
})
