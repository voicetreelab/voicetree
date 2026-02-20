import {
    getCachedZoom,
    registerFloatingWindow,
    unregisterFloatingWindow
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';

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
): { windowElement: HTMLElement; contentContainer: HTMLElement } {
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

    body.appendChild(titleEl);
    body.appendChild(preview);

    const editorArea: HTMLDivElement = document.createElement('div');
    editorArea.className = 'node-card-editor-area';
    editorArea.style.display = 'none';

    card.appendChild(accent);
    card.appendChild(trafficLights);
    card.appendChild(body);
    card.appendChild(editorArea);

    // Store base width for zoom scaling (updateWindowFromZoom reads dataset.baseWidth)
    card.dataset.baseWidth = '260';

    // Store graph position for zoom updates (following HoverEditor.ts:149-150 pattern)
    card.dataset.graphX = String(position.x);
    card.dataset.graphY = String(position.y);
    card.dataset.transformOrigin = 'center';

    const zoom: number = getCachedZoom();
    card.style.left = `${position.x * zoom}px`;
    card.style.top = `${position.y * zoom}px`;
    card.style.transform = `translate(-50%, -50%) scale(${zoom})`;

    // Register for pan/zoom sync
    registerFloatingWindow(nodeId + '-card', card);

    return { windowElement: card, contentContainer: editorArea };
}

export function destroyNodeCard(
    nodeId: string,
    windowElement: HTMLElement
): void {
    unregisterFloatingWindow(nodeId + '-card');
    windowElement.remove();
}
