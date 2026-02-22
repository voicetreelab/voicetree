import type { Core, CollectionReturnValue, NodeCollection, NodeSingular } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { getPresentation } from './NodePresentationStore';

// Concurrency guard — mirrors mountEditor's mountingEditors pattern
const mountingFolders: Set<string> = new Set();

/**
 * Mount folder content (child node list) into a folder presentation's body.
 * Called on HOVER/ANCHORED transitions for folder nodes instead of mountEditor.
 * Uses its own concurrency guard (mountingFolders Set).
 */
export async function mountFolderContent(
    cy: Core,
    nodeId: string,
    presentation: NodePresentation
): Promise<void> {
    if (mountingFolders.has(nodeId)) return;
    mountingFolders.add(nodeId);

    try {
        // Create content area if not present
        let contentArea: HTMLElement | null = presentation.element.querySelector('.folder-children-preview');
        if (!contentArea) {
            contentArea = document.createElement('div');
            contentArea.className = 'folder-children-preview';
            presentation.element.querySelector('.node-presentation-body')?.appendChild(contentArea);
        }

        // Get child nodes from Cy compound
        const compoundNode: CollectionReturnValue = cy.getElementById(nodeId);
        const children: NodeCollection = compoundNode.children();

        // Re-check: presentation might have been destroyed
        const recheck: NodePresentation | undefined = getPresentation(nodeId);
        if (!recheck) return;

        // Render child items
        contentArea.innerHTML = '';
        children.forEach((child: NodeSingular) => {
            const item: HTMLDivElement = document.createElement('div');
            item.className = 'folder-child-item';
            item.textContent = (child.data('label') as string) ?? child.id();
            item.dataset.nodeId = child.id();
            contentArea!.appendChild(item);
        });
    } finally {
        mountingFolders.delete(nodeId);
    }
}

/**
 * Dispose folder content mount state.
 * Called when destroying a folder presentation.
 */
export function disposeFolderContent(nodeId: string): void {
    mountingFolders.delete(nodeId);
}
