import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { removePresentation, getPresentation } from './NodePresentationStore';
import { disposeEditor } from './transitions';

export function destroyNodePresentation(nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;

    disposeEditor(nodeId);
    presentation.element.remove();
    removePresentation(nodeId);
}
