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
      '/project/docs/a.md': makeNode('/project/docs/a.md', 'A', { x: 10, y: 20 }),
      '/project/docs/b.md': makeNode('/project/docs/b.md', 'B'),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeFolderTree(): FolderTreeNode {
  return {
    name: 'project',
    absolutePath: toAbsolutePath('/project'),
    children: [
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/project/docs'),
        children: [
          { name: 'a.md', absolutePath: toAbsolutePath('/project/docs/a.md'), isInGraph: true },
          { name: 'b.md', absolutePath: toAbsolutePath('/project/docs/b.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'node_modules',
        absolutePath: toAbsolutePath('/project/node_modules'),
        children: [
          {
            name: 'dep',
            absolutePath: toAbsolutePath('/project/node_modules/dep'),
            children: [
              { name: 'index.js', absolutePath: toAbsolutePath('/project/node_modules/dep/index.js'), isInGraph: false },
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
      '/project/root.md': makeNode('/project/root.md', 'Root'),
      '/project/workspace/feature/leaf.md': makeNode('/project/workspace/feature/leaf.md', 'Leaf'),
      '/project/public/target.md': makeNode('/project/public/target.md', 'Target'),
      '/project/secret/new-link.md': makeNodeWithEdges('/project/secret/new-link.md', [
        { targetId: '/project/public/target.md', label: 'public/target' },
      ]),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeVisibilityFolderTree(): FolderTreeNode {
  return {
    name: 'project',
    absolutePath: toAbsolutePath('/project'),
    children: [
      { name: 'root.md', absolutePath: toAbsolutePath('/project/root.md'), isInGraph: true },
      {
        name: 'public',
        absolutePath: toAbsolutePath('/project/public'),
        children: [
          { name: 'target.md', absolutePath: toAbsolutePath('/project/public/target.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'secret',
        absolutePath: toAbsolutePath('/project/secret'),
        children: [
          { name: 'new-link.md', absolutePath: toAbsolutePath('/project/secret/new-link.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'workspace',
        absolutePath: toAbsolutePath('/project/workspace'),
        children: [
          {
            name: 'feature',
            absolutePath: toAbsolutePath('/project/workspace/feature'),
            children: [
              { name: 'leaf.md', absolutePath: toAbsolutePath('/project/workspace/feature/leaf.md'), isInGraph: true },
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
      '/project/source.md': makeNodeWithEdges('/project/source.md', [
        { targetId: '/project/archive/target.md', label: 'target' },
      ]),
      '/project/archive/target.md': makeNode('/project/archive/target.md', 'Target'),
      '/project/docs/archive/target.md': makeNode('/project/docs/archive/target.md', 'Nested target'),
      '/project/docs/direct.md': makeNode('/project/docs/direct.md', 'Direct'),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeDynamicFolderTree(): FolderTreeNode {
  return {
    name: 'project',
    absolutePath: toAbsolutePath('/project'),
    children: [
      { name: 'source.md', absolutePath: toAbsolutePath('/project/source.md'), isInGraph: true },
      {
        name: 'archive',
        absolutePath: toAbsolutePath('/project/archive'),
        children: [
          { name: 'target.md', absolutePath: toAbsolutePath('/project/archive/target.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/project/docs'),
        children: [
          { name: 'direct.md', absolutePath: toAbsolutePath('/project/docs/direct.md'), isInGraph: true },
          {
            name: 'archive',
            absolutePath: toAbsolutePath('/project/docs/archive'),
            children: [
              { name: 'target.md', absolutePath: toAbsolutePath('/project/docs/archive/target.md'), isInGraph: true },
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

function makeProject() {
  return {
    projectRoot: '/project',
    readPaths: ['/project/docs'],
    writeFolderPath: '/project',
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
    makeProject,
    makeVisibilityFolderTree,
    makeVisibilityGraph,
  }
}
