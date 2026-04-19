/**
 * Traffic Light Buttons - Reusable close/pin/fullscreen controls for floating windows
 *
 * Contains all close/pin/fullscreen logic for floating windows.
 * Detects window type (editor vs terminal) and handles appropriately.
 */

import type { Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import { Minus, Pin, Maximize, createElement } from 'lucide';
import { isImageNode, type NodeIdAndFilePath } from '@vt/graph-model/pure/graph';
import type { ShadowNodeId, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { isAnchored, getShadowNodeIdFromData, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getEditorByNodeId, isPinned, addToPinnedEditors, removeFromPinnedEditors } from '@/shell/edge/UI-edge/state/EditorStore';
import { getTerminal } from '@/shell/edge/UI-edge/state/TerminalStore';
import { attachFullscreenZoom } from '@/shell/edge/UI-edge/floating-windows/fullscreen-zoom';
import { minimizeTerminal, restoreTerminal } from '@/shell/UI/views/treeStyleTerminalTabs/terminalTabUtils';
import type { EditorData } from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type { TerminalData } from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import { closeHoverEditor } from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import { createAnchoredFloatingEditor } from "@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD";
import { getImageViewerByNodeId } from "@/shell/edge/UI-edge/state/ImageViewerStore";
import { closeHoverImageViewer, createAnchoredFloatingImageViewer } from "@/shell/edge/UI-edge/floating-windows/image-viewers/FloatingImageViewerCRUD";
import type { ImageViewerData } from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";

/** Options for creating traffic light buttons */
export interface TrafficLightOptions {
    /** Called when Close button is clicked */
    readonly onClose: () => void;
    /** Called when Pin button is clicked - returns new pinned state */
    readonly onPin: () => boolean;
    /** Initial pinned state */
    readonly isPinned: boolean;
    /** Cytoscape instance for fullscreen zoom (optional if fullscreen is not wired) */
    readonly cy?: Core;
    /** Shadow node ID for fullscreen zoom (optional if fullscreen is not wired) */
    readonly shadowNodeId?: ShadowNodeId;
    /** Whether to zoom to neighborhood (terminals) vs single node (editors) */
    readonly zoomToNeighborhood?: boolean;
}

export type TrafficLightTarget =
    | {
        readonly kind: 'hover-menu';
        readonly nodeId: NodeIdAndFilePath;
        readonly cy: Core;
        readonly closeMenu: () => void;
    }
    | {
        readonly kind: 'editor-window';
        readonly editor: EditorData;
        readonly cy: Core;
        readonly closeEditor: (cy: Core, editor: EditorData) => void;
    }
    | {
        readonly kind: 'terminal-window';
        readonly terminal: TerminalData;
        readonly cy: Core;
        readonly closeTerminal: (terminal: TerminalData, cy: Core) => Promise<void>;
    };

/**
 * Create traffic light buttons (Close, Pin, Fullscreen)
 * Returns a container div with three styled buttons
 */
export function createTrafficLights(options: TrafficLightOptions): HTMLDivElement {
    const container: HTMLDivElement = document.createElement('div');
    container.className = 'traffic-lights';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '4px';

    // Minimize button (orange)
    const closeBtn: HTMLButtonElement = document.createElement('button');
    closeBtn.className = 'traffic-light traffic-light-close';
    closeBtn.type = 'button';
    const closeIcon: SVGElement = createElement(Minus);
    closeIcon.setAttribute('width', '10');
    closeIcon.setAttribute('height', '10');
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        options.onClose();
    });

    // Pin button (yellow)
    const pinBtn: HTMLButtonElement = document.createElement('button');
    pinBtn.className = 'traffic-light traffic-light-pin';
    pinBtn.type = 'button';
    const pinIcon: SVGElement = createElement(Pin);
    pinIcon.setAttribute('width', '10');
    pinIcon.setAttribute('height', '10');
    pinBtn.appendChild(pinIcon);
    if (options.isPinned) {
        pinBtn.classList.add('pinned');
    }
    pinBtn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        const newPinnedState: boolean = options.onPin();
        pinBtn.classList.toggle('pinned', newPinnedState);
    });

    // Fullscreen button (green)
    const fullscreenBtn: HTMLButtonElement = document.createElement('button');
    fullscreenBtn.className = 'traffic-light traffic-light-fullscreen';
    fullscreenBtn.type = 'button';
    const fullscreenIcon: SVGElement = createElement(Maximize);
    fullscreenIcon.setAttribute('width', '10');
    fullscreenIcon.setAttribute('height', '10');
    fullscreenBtn.appendChild(fullscreenIcon);
    if (options.cy && options.shadowNodeId) {
        const cy = options.cy;
        const shadowNodeId = options.shadowNodeId;
        attachFullscreenZoom(
            cy,
            fullscreenBtn,
            shadowNodeId,
            () => cy.getElementById(shadowNodeId),
            options.zoomToNeighborhood ?? false
        );
    }

    container.appendChild(closeBtn);
    container.appendChild(pinBtn);
    container.appendChild(fullscreenBtn);

    return container;
}

export function createTrafficLightsForTarget(target: TrafficLightTarget): HTMLDivElement {
    if (target.kind === 'hover-menu') {
        const { nodeId, cy, closeMenu } = target;
        return createTrafficLights({
            onClose: (): void => {
                // Hover menu close is handled by closeMenu callback
                // (hover editors are closed via closeHoverEditor in the caller)
                closeMenu();
            },
            onPin: (): boolean => {
                // Handle image nodes - check for hover image viewer
                if (isImageNode(nodeId)) {
                    const imageViewer: O.Option<ImageViewerData> = getImageViewerByNodeId(nodeId);
                    if (O.isSome(imageViewer) && !isAnchored(imageViewer.value)) {
                        // Close hover image viewer and create anchored image viewer
                        closeHoverImageViewer(cy);
                        closeMenu();
                        void createAnchoredFloatingImageViewer(cy, nodeId);
                        return true;
                    }
                    // No hover image viewer open, just close menu and create anchored viewer
                    closeMenu();
                    void createAnchoredFloatingImageViewer(cy, nodeId);
                    return true;
                }

                // Handle markdown nodes — pin as floating editor
                const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
                if (O.isSome(editor) && !isAnchored(editor.value)) {
                    closeHoverEditor(cy);
                    closeMenu();
                    void createAnchoredFloatingEditor(cy, nodeId, false);
                    addToPinnedEditors(nodeId);
                    return true;
                }
                const currentlyPinned: boolean = isPinned(nodeId);
                if (currentlyPinned) {
                    removeFromPinnedEditors(nodeId);
                } else {
                    addToPinnedEditors(nodeId);
                }
                return !currentlyPinned;
            },
            isPinned: isPinned(nodeId),
            cy,
            shadowNodeId: nodeId as ShadowNodeId,
            zoomToNeighborhood: false,
        });
    }

    if (target.kind === 'editor-window') {
        const { editor, cy, closeEditor } = target;
        const nodeId: NodeIdAndFilePath = editor.contentLinkedToNodeId;
        // Editors don't create shadow nodes — anchored editors reuse the real
        // Cy node (AnchoredEditor.ts) and hover editors use graphX/graphY.
        // Zoom to the real node, matching the hover-menu pattern.
        const shadowNodeId: ShadowNodeId = nodeId as ShadowNodeId;
        return createTrafficLights({
            onClose: (): void => {
                closeEditor(cy, editor);
            },
            onPin: (): boolean => {
                // If this is a hover editor (not anchored), convert to anchored + pinned
                if (!isAnchored(editor)) {
                    closeHoverEditor(cy);
                    void createAnchoredFloatingEditor(cy, nodeId, false);
                    addToPinnedEditors(nodeId);
                    return true;
                }
                const currentlyPinned: boolean = isPinned(nodeId);
                if (currentlyPinned) {
                    removeFromPinnedEditors(nodeId);
                } else {
                    addToPinnedEditors(nodeId);
                }
                return !currentlyPinned;
            },
            isPinned: isPinned(nodeId),
            cy,
            shadowNodeId,
            zoomToNeighborhood: false,
        });
    }

    // terminal-window
    const { terminal, cy, closeTerminal } = target;
    const terminalId: TerminalId = getTerminalId(terminal);
    const shadowNodeId: ShadowNodeId = getShadowNodeIdFromData(terminal);
    return createTrafficLights({
        onClose: (): void => {
            void closeTerminal(terminal, cy);
        },
        onPin: (): boolean => {
            // Get current terminal state from store (not captured closure)
            const currentTerminal: O.Option<TerminalData> = getTerminal(terminalId);
            if (O.isNone(currentTerminal)) return false;
            if (currentTerminal.value.isMinimized) {
                restoreTerminal(terminalId);
                return false;
            } else {
                minimizeTerminal(terminalId);
                return true;
            }
        },
        isPinned: terminal.isMinimized,
        cy,
        shadowNodeId,
        zoomToNeighborhood: true,
    });
}
