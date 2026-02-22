import type { Core } from 'cytoscape';
import type { NodePresentation, NodeState } from '@/pure/graph/node-presentation/types';
import { computeMorphValues, type MorphValues } from '@/pure/graph/node-presentation/zoomMorph';
import { getCachedZoom, registerFloatingWindow, getOrCreateOverlay } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { addPresentation } from './NodePresentationStore';

/**
 * Create a folder-specific node presentation.
 * Uses the same NodePresentation type with kind='folder'.
 * DOM structure differs: child count badge + collapse toggle instead of content preview.
 */
export function createFolderPresentation(
    cy: Core,
    nodeId: string,
    title: string,
    childCount: number,
    accentColor: string | undefined,
    position: { x: number; y: number }
): NodePresentation {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'node-presentation folder-presentation state-card';
    card.dataset.nodeId = nodeId;

    const accent: HTMLDivElement = document.createElement('div');
    accent.className = 'node-presentation-accent';
    accent.style.background = accentColor ?? '#9b72cf';

    const body: HTMLDivElement = document.createElement('div');
    body.className = 'node-presentation-body';

    const titleEl: HTMLDivElement = document.createElement('div');
    titleEl.className = 'node-presentation-title';
    titleEl.textContent = title;

    const countBadge: HTMLSpanElement = document.createElement('span');
    countBadge.className = 'folder-child-count';
    countBadge.textContent = `${childCount} nodes`;

    const toggleBtn: HTMLButtonElement = document.createElement('button');
    toggleBtn.className = 'folder-toggle';
    toggleBtn.textContent = '\u25B6'; // ▶

    body.appendChild(titleEl);
    body.appendChild(countBadge);
    body.appendChild(toggleBtn);
    card.appendChild(accent);
    card.appendChild(body);

    // The Cy compound node IS the shadow node
    card.dataset.shadowNodeId = nodeId;
    card.dataset.transformOrigin = 'center';

    // Apply initial zoom-based morph (using 'folder' kind for future-proofing)
    const zoom: number = getCachedZoom();
    const morphValues: MorphValues = computeMorphValues(zoom);

    card.style.opacity = String(morphValues.cardOpacity);
    card.style.width = morphValues.cardWidth + 'px';
    card.style.minHeight = morphValues.cardMinHeight + 'px';
    card.style.maxHeight = morphValues.cardMaxHeight + 'px';
    card.style.borderRadius = morphValues.borderRadius + 'px';
    card.style.pointerEvents = morphValues.pointerEvents ? '' : 'none';
    card.style.left = `${position.x * zoom}px`;
    card.style.top = `${position.y * zoom}px`;
    card.style.transform = `translate(-50%, -50%) scale(${zoom})`;

    // Append to overlay and register
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(card);
    registerFloatingWindow(nodeId + '-presentation', card);

    const initialState: NodeState = morphValues.zone === 'plain' ? 'PLAIN' : 'CARD';

    const presentation: NodePresentation = {
        nodeId,
        element: card,
        kind: 'folder',
        state: initialState,
        isPinned: false,
        folderMeta: { childCount, manuallyCollapsed: false },
    };

    addPresentation(nodeId, presentation);
    return presentation;
}
