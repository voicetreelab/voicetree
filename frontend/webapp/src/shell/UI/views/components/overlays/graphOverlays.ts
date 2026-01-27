/**
 * Graph overlay components - DOM creation functions for VoiceTreeGraphView overlays
 * Extracted from VoiceTreeGraphView to separate concerns
 */

export interface LoadingOverlayResult {
    overlay: HTMLDivElement;
    messageElement: HTMLParagraphElement;
}

/**
 * Creates the loading overlay with spinner and message
 */
export function createLoadingOverlay(): LoadingOverlayResult {
    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = 'absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 text-muted-foreground pointer-events-none z-20';
    overlay.style.display = 'none';

    const spinner: HTMLDivElement = document.createElement('div');
    spinner.className = 'h-10 w-10 rounded-full border-2 border-blue-200 border-t-blue-500 animate-spin';

    const loadingMessage: HTMLParagraphElement = document.createElement('p');
    loadingMessage.className = 'text-base font-semibold text-foreground';
    loadingMessage.textContent = 'Loading VoiceTree...';

    const loadingSubtext: HTMLParagraphElement = document.createElement('p');
    loadingSubtext.className = 'text-xs text-muted-foreground/80';
    loadingSubtext.textContent = 'Preparing your workspace';

    overlay.appendChild(spinner);
    overlay.appendChild(loadingMessage);
    overlay.appendChild(loadingSubtext);

    return { overlay, messageElement: loadingMessage };
}

/**
 * Creates the error overlay (toast-style notification)
 */
export function createErrorOverlay(): HTMLDivElement {
    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = 'absolute top-4 right-4 bg-red-500 text-white px-3 py-1.5 rounded-md shadow-lg text-sm font-medium z-10';
    overlay.style.display = 'none';
    return overlay;
}

/**
 * Creates the empty state overlay shown when no graph is loaded
 */
export function createEmptyStateOverlay(): HTMLDivElement {
    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = 'absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none z-10';
    overlay.innerHTML = `
      <div class="text-center">
        <svg class="w-24 h-24 mx-auto mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="12" r="3" />
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M12 9 L6 6" />
          <path d="M12 9 L18 6" />
          <path d="M12 15 L6 18" />
          <path d="M12 15 L18 18" />
        </svg>
        <p class="text-sm">Graph visualization will appear here</p>
        <p class="text-xs text-muted-foreground/60 mt-2">Use "Open Folder" to watch markdown files live</p>
        <p class="text-xs text-muted-foreground/60">Powered by Cytoscape.js</p>
      </div>
    `;
    return overlay;
}

/**
 * Creates the stats overlay (bottom-right corner badge)
 */
export function createStatsOverlay(): HTMLDivElement {
    const overlay: HTMLDivElement = document.createElement('div');
    overlay.className = 'absolute bottom-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-muted-foreground pointer-events-none z-10';
    overlay.style.display = 'none';
    return overlay;
}

/**
 * Creates the title bar drag region for macOS window dragging
 */
export function createTitleBarDragRegion(): HTMLDivElement {
    const region: HTMLDivElement = document.createElement('div');
    region.className = 'title-bar-drag-region';
    return region;
}
