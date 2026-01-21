import type cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import type { NodeIdAndFilePath } from '@/pure/graph';
import type { Position } from '@/shell/UI/views/IVoiceTreeGraphView';

import {
    createImageViewerData,
    type ImageViewerId,
    type FloatingWindowUIData,
    getImageViewerId,
} from '@/shell/edge/UI-edge/floating-windows/types';

import {
    disposeFloatingWindow,
    getCachedZoom,
    getOrCreateOverlay,
    registerFloatingWindow,
} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';

import type { ImageViewerData } from '@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType';

import {
    addImageViewer,
    getImageViewerByNodeId,
    getHoverImageViewer,
} from '@/shell/edge/UI-edge/state/ImageViewerStore';

import { createWindowChrome } from '@/shell/edge/UI-edge/floating-windows/create-window-chrome';
import { anchorToNode } from '@/shell/edge/UI-edge/floating-windows/anchor-to-node';

/**
 * Browser-compatible basename function (Node.js path module doesn't work in browser)
 */
function getFilename(filePath: string): string {
    return filePath.substring(filePath.lastIndexOf('/') + 1);
}

/**
 * Create a floating image viewer window
 * Returns ImageViewerData with ui populated, or undefined if viewer already exists
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the image node to view
 * @param anchoredToNodeId - Optional node to anchor to (set for anchored, undefined for hover)
 */
export async function createFloatingImageViewer(
    cy: cytoscape.Core,
    nodeId: NodeIdAndFilePath,
    anchoredToNodeId: NodeIdAndFilePath | undefined
): Promise<ImageViewerData | undefined> {
    // Check if viewer already exists for this node
    const existingViewer: O.Option<ImageViewerData> = getImageViewerByNodeId(nodeId);
    if (O.isSome(existingViewer)) {
        console.log('[createFloatingImageViewer] Viewer already exists for node:', nodeId);
        return undefined;
    }

    // Derive title from filename (browser-compatible, no Node.js path module)
    const filename: string = getFilename(nodeId);
    const title: string = filename;

    // Create ImageViewerData using factory function
    const viewerData: ImageViewerData = createImageViewerData({
        imageNodeId: nodeId,
        title,
        anchoredToNodeId,
        resizable: true,
    });

    const viewerId: ImageViewerId = getImageViewerId(viewerData);

    // Create window chrome (returns FloatingWindowUIData)
    const ui: FloatingWindowUIData = createWindowChrome(cy, viewerData, viewerId, {
        agents: [], // No agents for image viewers
    });

    // Create ImageViewerData with ui populated (immutable update)
    const viewerWithUI: ImageViewerData = { ...viewerData, ui };

    // Create image element to display the image
    const imageElement: HTMLImageElement = document.createElement('img');
    imageElement.alt = title;
    imageElement.style.maxWidth = '100%';
    imageElement.style.maxHeight = '100%';
    imageElement.style.objectFit = 'contain';
    imageElement.style.display = 'block';
    imageElement.style.margin = 'auto';
    imageElement.draggable = false;

    // Load image via IPC (returns data URL or null)
    const dataUrl: string | null | undefined = await window.electronAPI?.main.readImageAsDataUrl(nodeId);
    if (dataUrl) {
        imageElement.src = dataUrl;
    } else {
        // Fallback: show alt text (image element with no src shows alt)
        console.warn(`[FloatingImageViewerCRUD] Could not load image: ${nodeId}`);
    }

    // Add image to content container
    ui.contentContainer.style.display = 'flex';
    ui.contentContainer.style.alignItems = 'center';
    ui.contentContainer.style.justifyContent = 'center';
    ui.contentContainer.style.overflow = 'hidden';
    ui.contentContainer.style.backgroundColor = '#1a1a1a';
    ui.contentContainer.appendChild(imageElement);

    // Handle traffic light close button click
    ui.windowElement.addEventListener('traffic-light-close', (): void => {
        closeImageViewer(cy, viewerWithUI);
    });

    // Add to overlay and register for efficient zoom/pan sync
    const overlay: HTMLElement = getOrCreateOverlay(cy);
    overlay.appendChild(ui.windowElement);
    registerFloatingWindow(viewerId, ui.windowElement);

    // Add to state
    addImageViewer(viewerWithUI);

    return viewerWithUI;
}

// =============================================================================
// Close Image Viewer
// =============================================================================

/**
 * Close an image viewer - dispose and remove from state
 */
export function closeImageViewer(cy: Core, viewer: ImageViewerData): void {
    disposeFloatingWindow(cy, viewer);
}

// =============================================================================
// Close Hover Image Viewer
// =============================================================================

/**
 * Close the current hover image viewer (viewer without anchor)
 */
export function closeHoverImageViewer(cy: Core): void {
    const hoverViewerOption: O.Option<ImageViewerData> = getHoverImageViewer();
    if (O.isNone(hoverViewerOption)) return;

    // Restore the node's Cytoscape label
    const nodeId: string = hoverViewerOption.value.imageNodeId;
    cy.getElementById(nodeId).removeClass('hover-editor-open');

    console.log('[FloatingImageViewerCRUD] Closing hover image viewer');
    closeImageViewer(cy, hoverViewerOption.value);
}

// =============================================================================
// Open Hover Image Viewer
// =============================================================================

/**
 * Open a hover image viewer at the given position
 */
export async function openHoverImageViewer(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    nodePos: Position
): Promise<void> {
    // Skip if this node already has a viewer open (hover or permanent)
    const existingViewer: O.Option<ImageViewerData> = getImageViewerByNodeId(nodeId);
    if (O.isSome(existingViewer)) {
        console.log('[HoverImageViewer] EARLY RETURN - node already has viewer:', nodeId);
        return;
    }
    console.log('[HoverImageViewer] No existing viewer, will create new one for:', nodeId);

    // Close any existing hover image viewer
    closeHoverImageViewer(cy);

    console.log('[FloatingImageViewerCRUD] Creating hover image viewer for node:', nodeId);

    try {
        // Create floating image viewer with anchoredToNodeId: undefined (hover mode, no shadow node)
        const viewer: ImageViewerData | undefined = await createFloatingImageViewer(
            cy,
            nodeId,
            undefined // Not anchored - hover mode
        );

        if (!viewer || !viewer.ui) {
            console.log('[FloatingImageViewerCRUD] Failed to create hover image viewer');
            return;
        }

        // Set position manually (no shadow node to sync with)
        // Position viewer below the node, clearing the node circle icon
        const HOVER_VIEWER_VERTICAL_OFFSET: number = 18;
        const zoom: number = getCachedZoom();
        const graphX: number = nodePos.x;
        const graphY: number = nodePos.y + HOVER_VIEWER_VERTICAL_OFFSET;

        // Store graph position for zoom updates (hover viewers have no shadow node)
        viewer.ui.windowElement.dataset.graphX = String(graphX);
        viewer.ui.windowElement.dataset.graphY = String(graphY);
        viewer.ui.windowElement.dataset.transformOrigin = 'top-center';

        // Apply initial position and transform with scale
        viewer.ui.windowElement.style.left = `${graphX * zoom}px`;
        viewer.ui.windowElement.style.top = `${graphY * zoom}px`;
        viewer.ui.windowElement.style.transformOrigin = 'top center';
        viewer.ui.windowElement.style.transform = `translateX(-50%) scale(${zoom})`;

        // Hide the node's Cytoscape label (viewer shows the name)
        cy.getElementById(nodeId).addClass('hover-editor-open');

        // Close on click outside
        const handleClickOutside: (e: MouseEvent) => void = (e: MouseEvent): void => {
            const target: Node = e.target as Node;
            const isInsideViewer: boolean = viewer.ui !== undefined && viewer.ui.windowElement.contains(target);
            // Also allow clicks on the hover menu
            const hoverMenu: HTMLElement | null = document.querySelector('.cy-horizontal-context-menu');
            const isInsideHoverMenu: boolean = hoverMenu !== null && hoverMenu.contains(target);
            if (!isInsideViewer && !isInsideHoverMenu) {
                console.log('[HoverImageViewer] Click outside detected, closing viewer');
                closeHoverImageViewer(cy);
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };

        // Add listener after a short delay to prevent immediate closure
        setTimeout((): void => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

    } catch (error) {
        console.error('[FloatingImageViewerCRUD] Error creating hover image viewer:', error);
    }
}

// =============================================================================
// Create Anchored Floating Image Viewer
// =============================================================================

/**
 * Create a floating image viewer window anchored to a node
 * Creates a child shadow node and anchors the viewer to it
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the image node to view
 */
export async function createAnchoredFloatingImageViewer(
    cy: Core,
    nodeId: NodeIdAndFilePath
): Promise<void> {
    try {
        // Early exit if viewer already exists
        if (O.isSome(getImageViewerByNodeId(nodeId))) {
            return;
        }

        // Create floating image viewer window with anchoredToNodeId set
        const viewer: ImageViewerData | undefined = await createFloatingImageViewer(
            cy,
            nodeId,
            nodeId // Anchor to the same node we're viewing
        );

        // Return early if viewer already exists
        if (!viewer) {
            console.log('[FloatingImageViewerCRUD] Viewer already exists');
            return;
        }

        // Anchor to node using v2 function
        anchorToNode(cy, viewer);

    } catch (error) {
        console.error('[FloatingImageViewerCRUD] Error creating anchored image viewer:', error);
    }
}
