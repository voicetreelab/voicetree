import type { Core } from 'cytoscape';
import type { NodePresentation, NodeState } from '@/pure/graph/node-presentation/types';
import { computeMorphValues, type MorphValues } from '@/pure/graph/node-presentation/zoomMorph';
import { getCachedZoom, registerFloatingWindow, getOrCreateOverlay } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { addPresentation } from './NodePresentationStore';

function extractPreviewLines(content: string, maxLines: number = 3): string {
    return content
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .slice(0, maxLines)
        .join('\n');
}

export function createNodePresentation(
    cy: Core,
    nodeId: string,
    title: string,
    contentPreview: string,
    accentColor: string | undefined,
    position: { x: number; y: number }
): NodePresentation {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'node-presentation state-card';
    card.dataset.nodeId = nodeId;

    const accent: HTMLDivElement = document.createElement('div');
    accent.className = 'node-presentation-accent';
    accent.style.background = accentColor ?? '#4a9eff';

    const body: HTMLDivElement = document.createElement('div');
    body.className = 'node-presentation-body';

    const titleEl: HTMLDivElement = document.createElement('div');
    titleEl.className = 'node-presentation-title';
    titleEl.textContent = title;

    const preview: HTMLDivElement = document.createElement('div');
    preview.className = 'node-presentation-preview';
    preview.textContent = extractPreviewLines(contentPreview);

    body.appendChild(titleEl);
    body.appendChild(preview);
    card.appendChild(accent);
    card.appendChild(body);

    // The Cy node IS the shadow node — same mechanism as editor shadow nodes
    card.dataset.shadowNodeId = nodeId;
    card.dataset.transformOrigin = 'center';

    // Apply initial zoom-based morph
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

    // Append to overlay and register for pan/zoom sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(card);
    registerFloatingWindow(nodeId + '-presentation', card);

    const initialState: NodeState = morphValues.zone === 'plain' ? 'PLAIN' : 'CARD';

    const presentation: NodePresentation = {
        nodeId,
        element: card,
        state: initialState,
        isPinned: false,
    };

    addPresentation(nodeId, presentation);
    return presentation;
}
