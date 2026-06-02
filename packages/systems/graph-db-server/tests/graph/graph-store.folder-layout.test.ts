/**
 * Black-box tests for graph-store's folder-layout cell — the in-memory source
 * of truth for expanded-folder sizes keyed by FolderId, sharing graph-store's
 * single mutable cell with the graph. Asserts on observable state via
 * getFolderLayout(), not on internals.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Size } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import {
  clearFolderLayout,
  getFolderLayout,
  getGraph,
  isFolderLayoutKey,
  mergeFolderLayout,
  setGraph,
} from '@vt/graph-db-server/state/graph-store'

afterEach(() => {
  clearFolderLayout()
  setGraph(createGraph({}))
})

describe('isFolderLayoutKey', () => {
  it('treats trailing-slash ids as folder keys and file paths as not', () => {
    expect(isFolderLayoutKey('/proj/work/')).toBe(true)
    expect(isFolderLayoutKey('/proj/work/note.md')).toBe(false)
  })
})

describe('folder-layout store', () => {
  it('starts empty', () => {
    expect(getFolderLayout().size).toBe(0)
  })

  it('merges entries last-wins and accumulates across calls', () => {
    mergeFolderLayout(new Map<string, Size>([['/a/', { width: 100, height: 50 }]]))
    mergeFolderLayout(new Map<string, Size>([
      ['/a/', { width: 200, height: 60 }],   // overwrites
      ['/b/', { width: 80, height: 40 }],     // adds
    ]))
    const layout = getFolderLayout()
    expect(layout.get('/a/')).toEqual({ width: 200, height: 60 })
    expect(layout.get('/b/')).toEqual({ width: 80, height: 40 })
  })

  it('clears all entries', () => {
    mergeFolderLayout(new Map<string, Size>([['/a/', { width: 1, height: 1 }]]))
    clearFolderLayout()
    expect(getFolderLayout().size).toBe(0)
  })

  // The cell is shared with the graph: setGraph must not wipe folder sizes.
  it('preserves folder sizes across setGraph', () => {
    mergeFolderLayout(new Map<string, Size>([['/a/', { width: 320, height: 240 }]]))
    setGraph(createGraph({}))
    expect(getFolderLayout().get('/a/')).toEqual({ width: 320, height: 240 })
    expect(getGraph().nodes).toEqual({})
  })
})
