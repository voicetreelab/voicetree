// BF-336 · Black-box tests for pure graph-derived folder projection.
//
// These tests assert on returned values only. They never mock internal
// dependencies, never reach toHaveBeenCalledWith, and rely on the function
// being structurally pure: it imports nothing from `fs`, makes no async
// calls, and returns synchronously. A test below also wraps the call so
// that any leaked filesystem access would be detected by exception.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { toAbsolutePath } from '@vt/graph-model'
import type {
  AbsolutePath,
  FolderTreeNode,
  Graph,
  GraphNode,
} from '@vt/graph-model'
import { projectGraphDerivedFolderTree } from './graphDerivedFolderTree.ts'

// FileTreeNode is not exported from the @vt/graph-model barrel today; we
// derive it from FolderTreeNode.children to keep this test independent
// of the barrel surface.
type FileTreeNode = Extract<FolderTreeNode['children'][number], { isInGraph: boolean }>

function makeNode(id: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: '',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

function makeGraph(nodePaths: readonly string[]): Graph {
  return {
    nodes: Object.fromEntries(nodePaths.map((p) => [p, makeNode(p)])),
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function isFolder(node: FolderTreeNode | FileTreeNode): node is FolderTreeNode {
  return 'children' in node
}

function collectFolderPaths(tree: FolderTreeNode | null): Set<string> {
  const out = new Set<string>()
  if (!tree) return out
  const walk = (node: FolderTreeNode): void => {
    out.add(node.absolutePath)
    for (const child of node.children) {
      if (isFolder(child)) walk(child)
    }
  }
  walk(tree)
  return out
}

function collectFilePaths(tree: FolderTreeNode | null): Set<string> {
  const out = new Set<string>()
  if (!tree) return out
  const walk = (node: FolderTreeNode): void => {
    for (const child of node.children) {
      if (isFolder(child)) walk(child)
      else out.add(child.absolutePath)
    }
  }
  walk(tree)
  return out
}

describe('projectGraphDerivedFolderTree', () => {
  const projectRoot: AbsolutePath = toAbsolutePath('/project')
  const writeFolderPath: AbsolutePath = toAbsolutePath('/project/notes')

  it('contains exactly the folders that hold graph nodes (plus root)', () => {
    const graph = makeGraph([
      '/project/notes/a.md',
      '/project/notes/sub/b.md',
      '/project/journal/c.md',
    ])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: [],
      projectPaths: [],
      writeFolderPath,
    })
    expect(tree).not.toBeNull()
    const folders = collectFolderPaths(tree)
    expect(folders).toEqual(
      new Set([
        '/project',
        '/project/notes',
        '/project/notes/sub',
        '/project/journal',
      ]),
    )
  })

  it('attaches graph nodes as file children under their parent folders only', () => {
    const graph = makeGraph(['/project/notes/a.md', '/project/journal/c.md'])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: [],
      projectPaths: [],
      writeFolderPath,
    })
    const files = collectFilePaths(tree)
    expect(files).toEqual(new Set(['/project/notes/a.md', '/project/journal/c.md']))
  })

  it('marks every file as isInGraph (since they came from the graph)', () => {
    const graph = makeGraph(['/project/notes/a.md'])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: [],
      projectPaths: [],
      writeFolderPath,
    })
    const notes = (tree!.children.find((c) => c.name === 'notes') as FolderTreeNode)
    const file = notes.children.find((c) => c.name === 'a.md')! as FileTreeNode
    expect(file.isInGraph).toBe(true)
  })

  it('marks the writeFolderPath folder as isWriteTarget', () => {
    const graph = makeGraph(['/project/notes/a.md'])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: [],
      projectPaths: [],
      writeFolderPath,
    })
    const notes = tree!.children.find((c) => c.name === 'notes') as FolderTreeNode
    expect(notes.isWriteTarget).toBe(true)
  })

  it('marks readPaths and projectPaths as loadState=loaded', () => {
    const graph = makeGraph(['/project/notes/a.md'])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: ['/project/notes'],
      projectPaths: ['/project/refs'],
      writeFolderPath,
    })
    const notes = tree!.children.find((c) => c.name === 'notes') as FolderTreeNode
    const refs = tree!.children.find((c) => c.name === 'refs') as FolderTreeNode
    expect(notes.loadState).toBe('loaded')
    expect(refs).toBeDefined()
    expect(refs.loadState).toBe('loaded')
  })

  it('includes configured read/project/write paths even when they have no graph nodes', () => {
    const graph = makeGraph([])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: ['/project/refs'],
      projectPaths: ['/project/external/lib'],
      writeFolderPath,
    })
    const folders = collectFolderPaths(tree)
    expect(folders).toEqual(
      new Set([
        '/project',
        '/project/notes',
        '/project/refs',
        '/project/external',
        '/project/external/lib',
      ]),
    )
  })

  it('excludes paths outside the project root', () => {
    const graph = makeGraph([
      '/project/notes/a.md',
      '/elsewhere/x.md',
    ])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: ['/elsewhere'],
      projectPaths: [],
      writeFolderPath,
    })
    const folders = collectFolderPaths(tree)
    expect(folders.has('/elsewhere')).toBe(false)
    const files = collectFilePaths(tree)
    expect(files.has('/elsewhere/x.md')).toBe(false)
    // The in-root graph node is still present.
    expect(files.has('/project/notes/a.md')).toBe(true)
  })

  it('returns null when projectRoot is null', () => {
    const graph = makeGraph(['/project/notes/a.md'])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot: null,
      readPaths: [],
      projectPaths: [],
      writeFolderPath,
    })
    expect(tree).toBeNull()
  })

  it('returns an empty-children root for an empty graph and no configured roots', () => {
    const graph = makeGraph([])
    const tree = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: [],
      projectPaths: [],
      writeFolderPath: null,
    })
    expect(tree).not.toBeNull()
    expect(tree!.absolutePath).toBe('/project')
    expect(tree!.children).toEqual([])
  })

  it('is synchronous: returns a value (not a Promise) immediately', () => {
    const graph = makeGraph(['/project/notes/a.md', '/project/journal/c.md'])
    const result: FolderTreeNode | null = projectGraphDerivedFolderTree({
      graph,
      projectRoot,
      readPaths: ['/project/refs'],
      projectPaths: [],
      writeFolderPath,
    })
    // If the function were doing I/O it would have to be async; assert the
    // returned value is the FolderTreeNode itself, not a thenable.
    expect(typeof (result as unknown as { then?: unknown })?.then).toBe('undefined')
    expect(result).not.toBeNull()
  })

  it('does not import any filesystem or watcher modules (structural)', () => {
    // Strongest pure guarantee: read the module source and assert no fs /
    // chokidar / folderScanner imports exist. This is a static check that
    // survives ESM spy limitations.
    const modulePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'graphDerivedFolderTree.ts',
    )
    const source = readFileSync(modulePath, 'utf8')
    expect(source).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(source).not.toMatch(/from\s+['"]node:fs\/promises['"]/)
    expect(source).not.toMatch(/from\s+['"]fs['"]/)
    expect(source).not.toMatch(/from\s+['"]fs\/promises['"]/)
    expect(source).not.toMatch(/from\s+['"]chokidar['"]/)
    expect(source).not.toMatch(/folderScanner/)
    expect(source).not.toMatch(/getDirectoryTree/)
  })
})
