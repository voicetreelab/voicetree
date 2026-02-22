import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { unregisterFloatingWindow } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { removePresentation, getPresentation } from './NodePresentationStore';
import { disposeEditor } from './transitions';

export function destroyNodePresentation(nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;

    disposeEditor(nodeId);
    unregisterFloatingWindow(nodeId + '-presentation');
    presentation.element.remove();
    removePresentation(nodeId);
}
