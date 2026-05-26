import type { GraphDelta } from '@/pure/graph';

type Position = {
  readonly x: number;
  readonly y: number;
};

export type ChildEdge = {
  readonly targetId: string;
  readonly label: string;
};

function createNodeUIMetadata(position: Position) {
  return {
    color: { _tag: 'None' } as const,
    position: { _tag: 'Some', value: position } as const,
    additionalYAMLProps: new Map(),
    isContextNode: false,
  };
}

/**
 * Create a parent node GraphDelta at the given position.
 */
export function createParentDelta(parentId: string, pos: Position): GraphDelta {
  return [
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: parentId,
        contentWithoutYamlOrLinks: '# Root Node\nThe root of the test tree.',
        outgoingEdges: [],
        nodeUIMetadata: createNodeUIMetadata(pos)
      },
      previousNode: { _tag: 'None' } as const
    }
  ];
}

export function createChildAndParentDelta(args: {
  readonly childId: string;
  readonly childContent: string;
  readonly childPosition: Position;
  readonly parentId: string;
  readonly parentContent: string;
  readonly parentPosition: Position;
  readonly childEdges: readonly ChildEdge[];
}): GraphDelta {
  return [
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: args.childId,
        contentWithoutYamlOrLinks: args.childContent,
        outgoingEdges: [],
        nodeUIMetadata: createNodeUIMetadata(args.childPosition)
      },
      previousNode: { _tag: 'None' } as const
    },
    {
      type: 'UpsertNode' as const,
      nodeToUpsert: {
        absoluteFilePathIsID: args.parentId,
        contentWithoutYamlOrLinks: args.parentContent,
        outgoingEdges: [...args.childEdges],
        nodeUIMetadata: createNodeUIMetadata(args.parentPosition)
      },
      previousNode: { _tag: 'None' } as const
    }
  ];
}
