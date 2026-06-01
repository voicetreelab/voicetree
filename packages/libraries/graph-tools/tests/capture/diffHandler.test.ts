/**
 * REC 8 — `vt-debug diff` end-to-end over on-disk capture files.
 *
 * Real captures are written by `capture.ts` via `serializeState(state)`, which
 * OMITS the optional `roots.loaded` and `collapseSet` fields. Before the fix,
 * `diffCaptures.normalizeState` spread those undefined fields and threw
 * "TypeError: values is not iterable". This test writes two such minimal
 * captures to a temp dir and drives the registered `diff` handler exactly as
 * the CLI does, asserting it returns a SnapshotDiff instead of throwing.
 *
 * Black-box: feeds real files through the registry handler; asserts on the
 * returned Response. No live app / CDP needed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SerializedState } from '@vt/graph-state'

import '../../src/commands/capture/diff' // registers 'diff'
import { commandRegistry } from '../../src/commands/index'
import type { Snapshot } from '../../src/debug/state/captureDiff'

// Mirrors exactly what serializeState() writes: NO roots.loaded, NO collapseSet.
function onDiskSnapshot(revision: number, selection: readonly string[]): Snapshot {
  const state: SerializedState = {
    graph: {
      nodes: {},
      incomingEdgesIndex: [],
      nodeByBaseName: [],
      unresolvedLinksIndex: [],
    },
    roots: { folderTree: [] },
    selection: [...selection],
    layout: { positions: [] },
    meta: { schemaVersion: 1, revision },
  }
  return {
    state,
    cyDump: null,
    focused: null,
    selection: [...selection],
    zoom: null,
    pan: null,
    timestamp: '2026-04-19T00:00:00.000Z',
  }
}

describe('diff handler over on-disk captures', () => {
  let dir: string
  let a: string
  let b: string

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'vt-diff-'))
    a = path.join(dir, 'a.json')
    b = path.join(dir, 'b.json')
    writeFileSync(a, `${JSON.stringify(onDiskSnapshot(1, []), null, 2)}\n`, 'utf8')
    writeFileSync(b, `${JSON.stringify(onDiskSnapshot(2, ['x.md']), null, 2)}\n`, 'utf8')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns a SnapshotDiff (no "values is not iterable" throw)', async () => {
    const diff = commandRegistry.get('diff')
    expect(diff).toBeDefined()

    const response = await diff!([a, b])

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result).toHaveProperty('changed')
      // Selection differs between the two captures; everything else is equal.
      expect(response.result).toEqual({ changed: ['selection'] })
    }
  })
})
