import * as O from 'fp-ts/lib/Option.js'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import type { Session } from '../types.ts'

function makeNode(id: string, content: string, position?: { x: number; y: number }): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: position ? O.some(position) : O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function makeNodeWithEdges(
  id: string,
  outgoingEdges: GraphNode['outgoingEdges'],
): GraphNode {
  return {
    ...makeNode(id, id),
    outgoingEdges,
  }
}

function makeGraph(): Graph {
  return {
    nodes: {
      '/vault/docs/a.md': makeNode('/vault/docs/a.md', 'A', { x: 10, y: 20 }),
      '/vault/docs/b.md': makeNode('/vault/docs/b.md', 'B'),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeFolderTree(): FolderTreeNode {
  return {
    name: 'vault',
    absolutePath: toAbsolutePath('/vault'),
    children: [
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/vault/docs'),
        children: [
          { name: 'a.md', absolutePath: toAbsolutePath('/vault/docs/a.md'), isInGraph: true },
          { name: 'b.md', absolutePath: toAbsolutePath('/vault/docs/b.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'node_modules',
        absolutePath: toAbsolutePath('/vault/node_modules'),
        children: [
          {
            name: 'dep',
            absolutePath: toAbsolutePath('/vault/node_modules/dep'),
            children: [
              { name: 'index.js', absolutePath: toAbsolutePath('/vault/node_modules/dep/index.js'), isInGraph: false },
            ],
            loadState: 'not-loaded',
            isWriteTarget: false,
          },
        ],
        loadState: 'not-loaded',
        isWriteTarget: false,
      },
    ],
    loadState: 'loaded',
    isWriteTarget: true,
  }
}

function makeVisibilityGraph(): Graph {
  return {
    nodes: {
      '/vault/root.md': makeNode('/vault/root.md', 'Root'),
      '/vault/workspace/feature/leaf.md': makeNode('/vault/workspace/feature/leaf.md', 'Leaf'),
      '/vault/public/target.md': makeNode('/vault/public/target.md', 'Target'),
      '/vault/secret/new-link.md': makeNodeWithEdges('/vault/secret/new-link.md', [
        { targetId: '/vault/public/target.md', label: 'public/target' },
      ]),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeVisibilityFolderTree(): FolderTreeNode {
  return {
    name: 'vault',
    absolutePath: toAbsolutePath('/vault'),
    children: [
      { name: 'root.md', absolutePath: toAbsolutePath('/vault/root.md'), isInGraph: true },
      {
        name: 'public',
        absolutePath: toAbsolutePath('/vault/public'),
        children: [
          { name: 'target.md', absolutePath: toAbsolutePath('/vault/public/target.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'secret',
        absolutePath: toAbsolutePath('/vault/secret'),
        children: [
          { name: 'new-link.md', absolutePath: toAbsolutePath('/vault/secret/new-link.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'workspace',
        absolutePath: toAbsolutePath('/vault/workspace'),
        children: [
          {
            name: 'feature',
            absolutePath: toAbsolutePath('/vault/workspace/feature'),
            children: [
              { name: 'leaf.md', absolutePath: toAbsolutePath('/vault/workspace/feature/leaf.md'), isInGraph: true },
            ],
            loadState: 'loaded',
            isWriteTarget: false,
          },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
    ],
    loadState: 'loaded',
    isWriteTarget: true,
  }
}

function makeDynamicMoveGraph(): Graph {
  return {
    nodes: {
      '/vault/source.md': makeNodeWithEdges('/vault/source.md', [
        { targetId: '/vault/archive/target.md', label: 'target' },
      ]),
      '/vault/archive/target.md': makeNode('/vault/archive/target.md', 'Target'),
      '/vault/docs/archive/target.md': makeNode('/vault/docs/archive/target.md', 'Nested target'),
      '/vault/docs/direct.md': makeNode('/vault/docs/direct.md', 'Direct'),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeDynamicFolderTree(): FolderTreeNode {
  return {
    name: 'vault',
    absolutePath: toAbsolutePath('/vault'),
    children: [
      { name: 'source.md', absolutePath: toAbsolutePath('/vault/source.md'), isInGraph: true },
      {
        name: 'archive',
        absolutePath: toAbsolutePath('/vault/archive'),
        children: [
          { name: 'target.md', absolutePath: toAbsolutePath('/vault/archive/target.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/vault/docs'),
        children: [
          { name: 'direct.md', absolutePath: toAbsolutePath('/vault/docs/direct.md'), isInGraph: true },
          {
            name: 'archive',
            absolutePath: toAbsolutePath('/vault/docs/archive'),
            children: [
              { name: 'target.md', absolutePath: toAbsolutePath('/vault/docs/archive/target.md'), isInGraph: true },
            ],
            loadState: 'loaded',
            isWriteTarget: false,
          },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
    ],
    loadState: 'loaded',
    isWriteTarget: true,
  }
}

function makeVault() {
  return {
    projectRoot: '/vault',
    readPaths: ['/vault/docs'],
    writeFolder: '/vault',
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    folderState: new Map(),
    collapseSet: new Set(),
    selection: new Set(),
    expandOverrides: new Set(),
    layout: { positions: {}, pan: { x: 0, y: 0 }, zoom: 1 },
    lastAccessedAt: 1700000000000,
    ...overrides,
  }
}

export function makeProjectSessionStateFixtures() {
  return {
    makeDynamicFolderTree,
    makeDynamicMoveGraph,
    makeFolderTree,
    makeGraph,
    makeSession,
    makeVault,
    makeVisibilityFolderTree,
    makeVisibilityGraph,
  }
}
