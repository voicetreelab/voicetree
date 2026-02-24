import type { NodePresentation } from '@/pure/graph/node-presentation/types';

const presentations: Map<string, NodePresentation> = new Map();

export function getPresentation(nodeId: string): NodePresentation | undefined {
    return presentations.get(nodeId);
}

export function addPresentation(nodeId: string, presentation: NodePresentation): void {
    presentations.set(nodeId, presentation);
}

export function removePresentation(nodeId: string): void {
    presentations.delete(nodeId);
}

export function getAllPresentations(): IterableIterator<NodePresentation> {
    return presentations.values();
}
