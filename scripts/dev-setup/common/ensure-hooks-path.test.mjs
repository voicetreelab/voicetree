import assert from 'node:assert/strict'
import test from 'node:test'

import { needsHooksPathUpdate } from './ensure-hooks-path.mjs'

test('no update needed when core.hooksPath already equals scripts/hooks', () => {
  assert.equal(needsHooksPathUpdate('scripts/hooks'), false)
  assert.equal(needsHooksPathUpdate('scripts/hooks\n'), false) // trimmed
})

test('update needed when unset, empty, or pointing elsewhere', () => {
  assert.equal(needsHooksPathUpdate(''), true)
  assert.equal(needsHooksPathUpdate(undefined), true)
  assert.equal(needsHooksPathUpdate('.git/hooks'), true)
  assert.equal(needsHooksPathUpdate('/Users/x/voicetree/.git/hooks'), true)
})
