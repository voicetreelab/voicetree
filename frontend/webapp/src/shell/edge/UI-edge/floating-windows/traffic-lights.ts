/**
 * Traffic Light Buttons - Reusable close/pin/fullscreen controls for floating windows
 *
 * Extracted from HorizontalMenuService for reuse by both editors and terminals.
 * Provides consistent macOS-style traffic light buttons with proper callbacks.
 */

import type { Core } from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import { X, Pin, Maximize, createElement } from 'lucide';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { ShadowNodeId, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { isAnchored } from '@/shell/edge/UI-edge/floating-windows/types';
import { getEditorByNodeId, isPinned, addToPinnedEditors, removeFromPinnedEditors } from '@/shell/edge/UI-edge/state/EditorStore';
import { attachFullscreenZoom } from '@/shell/edge/UI-edge/floating-windows/fullscreen-zoom';
import { closeHoverEditor, createAnchoredFloatingEditor } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import { unpinTerminal } from '@/shell/UI/views/AgentTabsBar';
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";

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
        readonly nodeId: NodeIdAndFilePath;
        readonly cy: Core;
        readonly shadowNodeId: ShadowNodeId;
        readonly onClose: () => void;
    }
    | {
        readonly kind: 'terminal-window';
        readonly terminalId: TerminalId;
        readonly cy: Core;
        readonly shadowNodeId: ShadowNodeId;
        readonly onClose: () => void;
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

    // Close button (red)
    const closeBtn: HTMLButtonElement = document.createElement('button');
    closeBtn.className = 'traffic-light traffic-light-close';
    closeBtn.type = 'button';
    const closeIcon: SVGElement = createElement(X);
    closeIcon.setAttribute('width', '8');
    closeIcon.setAttribute('height', '8');
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
    pinIcon.setAttribute('width', '8');
    pinIcon.setAttribute('height', '8');
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
    fullscreenIcon.setAttribute('width', '8');
    fullscreenIcon.setAttribute('height', '8');
    fullscreenBtn.appendChild(fullscreenIcon);
    if (options.cy && options.shadowNodeId) {
        attachFullscreenZoom(
            options.cy,
            fullscreenBtn,
            options.shadowNodeId,
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
                const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
                if (O.isSome(editor) && !isAnchored(editor.value)) {
                    closeHoverEditor(cy);
                }
                closeMenu();
            },
            onPin: (): boolean => {
                const editor: O.Option<EditorData> = getEditorByNodeId(nodeId);
                if (O.isSome(editor) && !isAnchored(editor.value)) {
                    closeHoverEditor(cy);
                    void createAnchoredFloatingEditor(cy, nodeId, true);
                    closeMenu();
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
        const { nodeId, cy, shadowNodeId, onClose } = target;
        return createTrafficLights({
            onClose,
            onPin: (): boolean => {
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

    const { terminalId, cy, shadowNodeId, onClose } = target;
    return createTrafficLights({
        onClose,
        onPin: (): boolean => {
            unpinTerminal(terminalId);
            return false;
        },
        isPinned: true,
        cy,
        shadowNodeId,
        zoomToNeighborhood: true,
    });
}
