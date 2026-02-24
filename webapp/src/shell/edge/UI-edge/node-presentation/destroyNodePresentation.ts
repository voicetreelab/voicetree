import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { removePresentation, getPresentation } from './NodePresentationStore';

export function destroyNodePresentation(nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;

    presentation.element.remove();
    removePresentation(nodeId);
}
