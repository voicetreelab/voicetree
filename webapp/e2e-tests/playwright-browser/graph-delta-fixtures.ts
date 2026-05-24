import type { GraphDelta } from '@/pure/graph';

export function createTestGraphDelta(): GraphDelta {
  return [
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-1.md',
        contentWithoutYamlOrLinks: '# Introduction\nThis is the introduction node.',
        outgoingEdges: [{ targetId: 'test-node-2.md', label: '' }],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 100, y: 100 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-2.md',
        contentWithoutYamlOrLinks: '# Architecture\nArchitecture documentation.',
        outgoingEdges: [{ targetId: 'test-node-3.md', label: '' }],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 300, y: 150 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-3.md',
        contentWithoutYamlOrLinks: '# Core Principles\nCore principles guide.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 500, y: 200 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-4.md',
        contentWithoutYamlOrLinks: '# API Design\nAPI design patterns.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 700, y: 250 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: 'test-node-5.md',
        contentWithoutYamlOrLinks: '# Testing Guide\nHow to test the system.',
        outgoingEdges: [],
        nodeUIMetadata: {
          color: { _tag: 'None' } as const,
          position: { _tag: 'Some', value: { x: 900, y: 300 } } as const,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      },
      previousNode: { _tag: 'None' } as const
    }
  ];
}
