import type cytoscape from "cytoscape";
import type {
    EditorId,
    FloatingWindowData,
    FloatingWindowFields,
    FloatingWindowUIData,
    ImageViewerId,
    TerminalId
} from "@/shell/edge/UI-edge/floating-windows/types";
import {isTerminalData, isEditorData} from "@/shell/edge/UI-edge/floating-windows/types";
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {EditorData} from "@/shell/edge/UI-edge/floating-windows/editors/editorDataType";
import type {Core} from 'cytoscape';
import {getScalingStrategy, getScreenDimensions, type ScalingStrategy} from "@/pure/graph/floating-windows/floatingWindowScaling";
import {selectFloatingWindowNode} from "@/shell/edge/UI-edge/floating-windows/select-floating-window-node";
import {getCachedZoom} from "@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows";
import * as O from 'fp-ts/lib/Option.js';
import { createNodeMenu } from "@/shell/UI/cytoscape-graph-ui/services/createNodeMenu";
import type {AgentConfig} from "@/pure/settings";
import {addResizeZones} from "./window-resize-zones";
import {createExpandButton} from "./expand-button";
import {createTerminalTitleBar} from "./terminal-title-bar";
import {vanillaFloatingWindowInstances} from "@/shell/edge/UI-edge/state/UIAppState";

/** Options for createWindowChrome */
export interface CreateWindowChromeOptions {
    /** Agents list for horizontal menu (editors only) */
    readonly agents?: readonly AgentConfig[];
    /** Current context retrieval distance for slider (editors only) */
    readonly currentDistance?: number;
    /** Close callback for terminals (required when fw is TerminalData) */
    readonly closeTerminal?: (terminal: TerminalData, cy: Core) => Promise<void>;
    /** Close callback for editors (required when fw is EditorData) */
    readonly closeEditor?: (cy: Core, editor: EditorData) => void;
}

/**
 * Create the window chrome (frame) with vanilla DOM
 * Returns DOM refs that will populate the `ui` field on FloatingWindowData
 *
 * Phase 1 refactor: No title bar. Traffic lights will be moved to horizontal menu in Phase 2A/3.
 *
 * NO stored callbacks - use disposeFloatingWindow() for cleanup
 */
export function createWindowChrome(
    cy: cytoscape.Core,
    fw: FloatingWindowData | FloatingWindowFields,
    id: EditorId | TerminalId | ImageViewerId,
    options: CreateWindowChromeOptions = {}
): FloatingWindowUIData {
    const dimensions: { width: number; height: number } = fw.shadowNodeDimensions;

    // Create main window container
    const windowElement: HTMLDivElement = document.createElement('div');
    windowElement.id = `window-${id}`;
    // Add type-specific class (terminal vs editor) for differentiated styling
    const typeClass: string = 'type' in fw ? `cy-floating-window-${fw.type.toLowerCase()}` : '';
    windowElement.className = `cy-floating-window ${typeClass}`.trim();
    windowElement.setAttribute('data-floating-window-id', id);

    // Store base dimensions for zoom scaling (used by updateWindowFromZoom)
    windowElement.dataset.baseWidth = String(dimensions.width);
    windowElement.dataset.baseHeight = String(dimensions.height);

    // Determine scaling strategy and apply initial dimensions
    const currentZoom: number = getCachedZoom();
    const isTerminal: boolean = typeClass.includes('terminal');
    const windowType: 'Terminal' | 'Editor' = isTerminal ? 'Terminal' : 'Editor';
    const strategy: ScalingStrategy = getScalingStrategy(windowType, currentZoom);
    const screenDimensions: {
        readonly width: number;
        readonly height: number
    } = getScreenDimensions(dimensions, currentZoom, strategy);

    windowElement.style.width = `${screenDimensions.width}px`;
    windowElement.style.height = `${screenDimensions.height}px`;
    windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

    if (fw.resizable) {
        windowElement.classList.add('resizable');
    }

    // Event isolation - prevent graph interactions
    windowElement.addEventListener('mousedown', (e: MouseEvent): void => {
        e.stopPropagation();
        selectFloatingWindowNode(cy, fw);
        // Focus the terminal so xterm receives keyboard input and scroll events
        // (clicking on window chrome doesn't natively focus the xterm textarea)
        const instance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(id);
        instance?.focus?.();
    });
    // Allow horizontal scroll to pan graph, block vertical scroll for in-window scrolling
    windowElement.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.stopPropagation();
        }
    }, {passive: false});

    // Create content container
    const contentContainer: HTMLDivElement = document.createElement('div');
    contentContainer.className = 'cy-floating-window-content';

    // Create horizontal menu for anchored editors only
    // Hover editors use HorizontalMenuService's hover menu instead (shows node in gap between pills)
    const isEditor: boolean = 'type' in fw && fw.type === 'Editor';
    const hasAnchoredNode: boolean = O.isSome(fw.anchoredToNodeId);
    const hasAgents: boolean = options.agents !== undefined && options.agents.length > 0;

    // Menu cleanup destroys floating slider when editor closes
    let menuCleanup: (() => void) | undefined;

    if (isEditor && hasAnchoredNode && hasAgents) {
        const nodeId: string = 'contentLinkedToNodeId' in fw ? fw.contentLinkedToNodeId : '';
        const isContextNode: boolean = nodeId.includes('.context_node.');

        // Type-narrow fw to EditorData for traffic lights
        const editorData: EditorData | undefined = 'type' in fw && isEditorData(fw) ? fw : undefined;
        if (!editorData) {
            throw new Error('Expected EditorData for editor-window traffic lights');
        }

        // Use factory function to create menu
        const { wrapper: menuWrapper, cleanup } = createNodeMenu({
            nodeId,
            cy,
            agents: options.agents ?? [],
            isContextNode,
            currentDistance: options.currentDistance,
            menuKind: {
                kind: 'editor-window',
                editor: editorData,
                closeEditor: options.closeEditor ?? ((): void => {
                    windowElement.dispatchEvent(new CustomEvent('traffic-light-close', { bubbles: true }));
                }),
            },
            spacerWidth: 10,
        });

        menuCleanup = cleanup;
        menuWrapper.className = 'cy-floating-window-horizontal-menu';
        windowElement.appendChild(menuWrapper);
    }

    // Phase 4: Terminal-specific chrome - minimal title bar with traffic lights at far right
    if (isTerminal && 'type' in fw && isTerminalData(fw)) {
        const terminalTitleBar: HTMLDivElement = createTerminalTitleBar(windowElement, cy, fw, options.closeTerminal);
        windowElement.appendChild(terminalTitleBar);
    }

    // Assemble window - content container only (no title bar in Phase 1)
    windowElement.appendChild(contentContainer);

    // Create bottom-right expand button (Phase 2B)
    const expandButton: HTMLButtonElement = createExpandButton(windowElement, dimensions);
    windowElement.appendChild(expandButton);

    // Create resize zones for edges and corners (Phase 2C)
    if (fw.resizable) {
        addResizeZones(windowElement);
    }

    return {windowElement, contentContainer, menuCleanup};
}
