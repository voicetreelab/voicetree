import {
    getCachedZoom,
    registerFloatingWindow,
    unregisterFloatingWindow
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import type {NodeCardData} from '@/shell/edge/UI-edge/state/NodeCardStore';

function extractPreviewLines(content: string, maxLines: number = 3): string {
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

    const trafficLights: HTMLDivElement = document.createElement('div');
    trafficLights.className = 'node-card-traffic-lights';

    const closeBtn: HTMLButtonElement = document.createElement('button');
    closeBtn.className = 'tl-close';
    closeBtn.title = 'Close';

    const pinBtn: HTMLButtonElement = document.createElement('button');
    pinBtn.className = 'tl-pin';
    pinBtn.title = 'Pin';

    const expandBtn: HTMLButtonElement = document.createElement('button');
    expandBtn.className = 'tl-expand';
    expandBtn.title = 'Expand';

    trafficLights.appendChild(closeBtn);
    trafficLights.appendChild(pinBtn);
    trafficLights.appendChild(expandBtn);

    const body: HTMLDivElement = document.createElement('div');
    body.className = 'node-card-body';

    const titleEl: HTMLDivElement = document.createElement('div');
    titleEl.className = 'node-card-title';
    titleEl.textContent = title;

    const preview: HTMLDivElement = document.createElement('div');
    preview.className = 'node-card-preview';
    preview.textContent = extractPreviewLines(contentPreview);

    // Editor area — hidden in minimal mode, shown in hover/full modes
    const editorArea: HTMLDivElement = document.createElement('div');
    editorArea.className = 'node-card-editor-area';

    body.appendChild(titleEl);
    body.appendChild(preview);
    body.appendChild(editorArea);

    card.appendChild(accent);
    card.appendChild(trafficLights);
    card.appendChild(body);

    // Store base width for zoom scaling (updateWindowFromZoom reads dataset.baseWidth)
    card.dataset.baseWidth = '260';

    // The Cy node IS the shadow node for this card — same mechanism as editor shadow nodes.
    // updateWindowFromZoom reads shadowNodeId to get live position from Cy (lines 82-88),
    // instead of static graphX/graphY which go stale when Cola layout moves the node.
    card.dataset.shadowNodeId = nodeId;
    card.dataset.transformOrigin = 'center';

    const zoom: number = getCachedZoom();
    card.style.left = `${position.x * zoom}px`;
    card.style.top = `${position.y * zoom}px`;
    card.style.transform = `translate(-50%, -50%) scale(${zoom})`;

    // Register for pan/zoom sync
    registerFloatingWindow(nodeId + '-card', card);

    return {
        windowElement: card,
        contentContainer: body,
        editorArea,
        editor: null,
        mode: 'minimal'
    };
}

export function destroyNodeCard(
    nodeId: string,
    card: NodeCardData
): void {
    // Dispose CodeMirror instance if mounted
    if (card.editor) {
        card.editor.dispose();
        card.editor = null;
    }
    unregisterFloatingWindow(nodeId + '-card');
    card.windowElement.remove();
}
