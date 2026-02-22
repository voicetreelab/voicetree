import {
    getCachedZoom,
    registerFloatingWindow,
    unregisterFloatingWindow
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import type {NodeCardData} from '@/shell/edge/UI-edge/state/NodeCardStore';

export function extractPreviewLines(content: string, maxLines: number = 3): string {
    return content
        .split('\n')
        .filter(line => line.trim().length > 0)
        .slice(0, maxLines)
        .join('\n');
}

export function createNodeCard(
    nodeId: string,
    title: string,
    contentPreview: string,
    accentColor: string | undefined,
    position: { x: number; y: number }
): NodeCardData {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'node-card';
    card.dataset.nodeId = nodeId;

    const accent: HTMLDivElement = document.createElement('div');
    accent.className = 'node-card-accent';
    accent.style.background = accentColor ?? '#4a9eff';

    const body: HTMLDivElement = document.createElement('div');
    body.className = 'node-card-body';

    const titleEl: HTMLDivElement = document.createElement('div');
    titleEl.className = 'node-card-title';
    titleEl.textContent = title;

    const preview: HTMLDivElement = document.createElement('div');
    preview.className = 'node-card-preview';
    preview.textContent = extractPreviewLines(contentPreview);

    body.appendChild(titleEl);
    body.appendChild(preview);

    card.appendChild(accent);
    card.appendChild(body);

    // The Cy node IS the shadow node for this card — same mechanism as editor shadow nodes.
    // updateWindowFromZoom reads shadowNodeId to get live position from Cy (lines 82-88),
    // instead of static graphX/graphY which go stale when Cola layout moves the node.
    card.dataset.shadowNodeId = nodeId;
    card.dataset.transformOrigin = 'center';
    card.style.opacity = '0'; // Start invisible — Cy node shows native circle; crossfade reveals card

    const zoom: number = getCachedZoom();
    card.style.left = `${position.x * zoom}px`;
    card.style.top = `${position.y * zoom}px`;
    card.style.transform = `translate(-50%, -50%) scale(${zoom})`;

    // Register for pan/zoom sync
    registerFloatingWindow(nodeId + '-card', card);

    return {
        windowElement: card,
        contentContainer: body,
    };
}

export function destroyNodeCard(
    nodeId: string,
    card: NodeCardData
): void {
    unregisterFloatingWindow(nodeId + '-card');
    card.windowElement.remove();
}
