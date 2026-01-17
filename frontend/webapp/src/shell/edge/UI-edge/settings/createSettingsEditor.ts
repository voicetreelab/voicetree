/**
 * Create a floating settings editor window
 * Loads settings from IPC and allows editing them as JSON
 *
 * Uses patterns from FloatingEditorCRUD.ts but adapted for non-graph-node editing:
 * - No contentLinkedToNodeId (settings aren't a graph node)
 * - Fixed position (not anchored to a parent node)
 * - Custom onChange (saves to IPC instead of graph)
 */

import type {} from '@/shell/electron';
import type cytoscape from 'cytoscape';
import type {Core, Position} from 'cytoscape';
import {getOrCreateOverlay, getCachedZoom} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import type {VTSettings} from '@/pure/settings/types';
import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import type {FloatingWindowFields, EditorId, ShadowNodeId} from '@/shell/edge/UI-edge/floating-windows/types';
import {cySmartCenter} from '@/utils/responsivePadding';
import * as O from 'fp-ts/lib/Option.js';
import {vanillaFloatingWindowInstances} from '@/shell/edge/UI-edge/state/UIAppState';
import {graphToScreenPosition, getWindowTransform, getScalingStrategy, getScreenDimensions} from '@/pure/floatingWindowScaling';
import {createWindowChrome} from "@/shell/edge/UI-edge/floating-windows/create-window-chrome";
import {X, createElement} from 'lucide';

const SETTINGS_EDITOR_ID: EditorId = 'settings-editor' as EditorId;
const SETTINGS_SHADOW_NODE_ID: ShadowNodeId = `shadow-${SETTINGS_EDITOR_ID}` as ShadowNodeId;

/**
 * Create a simple title bar with macOS-style close button for the settings editor
 * Settings editor only needs close functionality (no pin/fullscreen)
 */
function createSettingsTitleBar(onClose: () => void): HTMLDivElement {
    const titleBar: HTMLDivElement = document.createElement('div');
    titleBar.className = 'settings-title-bar';

    // Close button (red traffic light)
    const closeBtn: HTMLButtonElement = document.createElement('button');
    closeBtn.className = 'traffic-light traffic-light-close';
    closeBtn.type = 'button';
    const closeIcon: SVGElement = createElement(X);
    closeIcon.setAttribute('width', '8');
    closeIcon.setAttribute('height', '8');
    closeBtn.appendChild(closeIcon);
    closeBtn.addEventListener('click', (e: MouseEvent): void => {
        e.stopPropagation();
        onClose();
    });

    // Title text
    const titleText: HTMLSpanElement = document.createElement('span');
    titleText.className = 'settings-title-text';
    titleText.textContent = 'Settings';

    titleBar.appendChild(closeBtn);
    titleBar.appendChild(titleText);

    return titleBar;
}

/**
 * Check if the settings editor is currently open
 */
export function isSettingsEditorOpen(): boolean {
    return vanillaFloatingWindowInstances.has(SETTINGS_EDITOR_ID);
}

/**
 * Close the settings editor if it exists
 */
export function closeSettingsEditor(cy: Core): void {
    const editor: { dispose: () => void } | undefined = vanillaFloatingWindowInstances.get(SETTINGS_EDITOR_ID);
    if (!editor) return;

    // Dispose CodeMirror instance
    editor.dispose();

    // Remove from global state
    vanillaFloatingWindowInstances.delete(SETTINGS_EDITOR_ID);

    // Remove shadow node
    const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(SETTINGS_SHADOW_NODE_ID);
    if (shadowNode.length > 0) {
        shadowNode.remove();
    }

    // Remove DOM element
    const windowElement: HTMLElement | null = document.getElementById(`window-${SETTINGS_EDITOR_ID}`);
    if (windowElement) {
        windowElement.remove();
    }

    console.log('[createSettingsEditor] Settings editor closed');
}

export async function createSettingsEditor(cy: Core): Promise<void> {
    try {
        // Toggle behavior: close if already exists
        if (vanillaFloatingWindowInstances.has(SETTINGS_EDITOR_ID)) {
            closeSettingsEditor(cy);
            return;
        }

        // Check if electronAPI is available
        if (!window.electronAPI) {
            console.error('[createSettingsEditor] electronAPI not available');
            return;
        }

        // Load current settings from IPC
        const settings: VTSettings = await window.electronAPI.main.loadSettings() as VTSettings;
        const settingsJson: string = JSON.stringify(settings, null, 2);

        // Get overlay
        const overlay: HTMLElement = getOrCreateOverlay(cy);

        // Fixed size in graph coordinates
        const fixedWidth: number = 800;
        const fixedHeight: number = 600;

        // Create FloatingWindowFields for createWindowChrome
        const settingsWindowFields: FloatingWindowFields = {
            anchoredToNodeId: O.none,
            title: 'Settings',
            resizable: true,
            shadowNodeDimensions: { width: fixedWidth, height: fixedHeight },
        };

        // Create window chrome with CodeMirror editor
        const {windowElement, contentContainer} = createWindowChrome(cy, settingsWindowFields, SETTINGS_EDITOR_ID);

        // Add title bar with close button (prepend before content container)
        const titleBar: HTMLDivElement = createSettingsTitleBar(() => closeSettingsEditor(cy));
        windowElement.insertBefore(titleBar, contentContainer);

        // Create CodeMirror editor instance for JSON editing
        const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
            contentContainer,
            settingsJson,
            {
                autosaveDelay: 300,
                darkMode: document.documentElement.classList.contains('dark'),
                language: 'json'
            }
        );

        // Setup auto-save with validation
        editor.onChange((newContent: string) => {
            void (async () => {
                try {
                    // Parse JSON to validate
                    const parsedSettings: VTSettings = JSON.parse(newContent) as VTSettings;

                    // Save to IPC
                    if (window.electronAPI) {
                        await window.electronAPI.main.saveSettings(parsedSettings);
                        console.log('[createSettingsEditor] Settings saved successfully');
                    }
                } catch (error) {
                    // Show error to user for invalid JSON
                    console.error('[createSettingsEditor] Invalid JSON in settings:', error);
                }
            })();
        });

        // Store editor instance in global state (fixes Bug 1 - proper cleanup tracking)
        vanillaFloatingWindowInstances.set(SETTINGS_EDITOR_ID, editor);

        // Position in center of current viewport
        const pan: Position = cy.pan();
        const zoom: number = cy.zoom();
        const centerX: number = (cy.width() / 2 - pan.x) / zoom;
        const centerY: number = (cy.height() / 2 - pan.y) / zoom;

        // Create shadow node for the settings editor
        // Mark as laidOut: true to prevent layout from moving it (fixes Bug 2)
        const shadowNode: cytoscape.CollectionReturnValue = cy.add({
            group: 'nodes',
            data: {
                id: SETTINGS_SHADOW_NODE_ID,
                isFloatingWindow: true,
                isShadowNode: true,
                windowType: 'Settings',
                laidOut: true  // CRITICAL: Prevents layout from repositioning to 0,0
            },
            position: { x: centerX, y: centerY }
        });

        // Style shadow node (invisible but with dimensions for fitting)
        shadowNode.style({
            'opacity': 0,
            'events': 'no',
            'width': fixedWidth,
            'height': fixedHeight
        });

        // Store shadow node ID on DOM element for zoom/pan updates
        windowElement.dataset.shadowNodeId = SETTINGS_SHADOW_NODE_ID;
        windowElement.dataset.baseWidth = String(fixedWidth);
        windowElement.dataset.baseHeight = String(fixedHeight);

        // Position window using the same pattern as anchor-to-node
        const currentZoom: number = getCachedZoom();
        const strategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Editor', currentZoom);
        const screenDimensions: { readonly width: number; readonly height: number } = getScreenDimensions({ width: fixedWidth, height: fixedHeight }, currentZoom, strategy);
        const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: centerX, y: centerY }, currentZoom);

        windowElement.style.left = `${screenPos.x}px`;
        windowElement.style.top = `${screenPos.y}px`;
        windowElement.style.width = `${screenDimensions.width}px`;
        windowElement.style.height = `${screenDimensions.height}px`;
        windowElement.style.transform = getWindowTransform(strategy, currentZoom, 'center');
        windowElement.style.transformOrigin = 'center';
        windowElement.dataset.usingCssTransform = strategy === 'css-transform' ? 'true' : 'false';

        // Add to overlay
        overlay.appendChild(windowElement);

        // Navigate to settings editor using delayed double-animation pattern
        // This ensures animation happens after DOM is fully settled
        // Uses cySmartCenter which pans if zoom is comfortable, or zooms to 1.0 if not
        setTimeout(() => cySmartCenter(cy, shadowNode), 300);
        setTimeout(() => cySmartCenter(cy, shadowNode), 1200);

        console.log('[createSettingsEditor] Settings editor created successfully');
    } catch (error) {
        console.error('[createSettingsEditor] Failed to create settings editor:', error);
    }
}
