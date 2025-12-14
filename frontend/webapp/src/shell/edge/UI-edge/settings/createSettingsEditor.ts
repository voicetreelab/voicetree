/**
 * Create a floating settings editor window
 * Loads settings from IPC and allows editing them as JSON
 */

import type {} from '@/shell/electron';
import type cytoscape from 'cytoscape';
import type {Core, Position} from 'cytoscape';
import {createWindowChrome, getOrCreateOverlay} from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import type {VTSettings} from '@/pure/settings/types';
import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';
import type {FloatingWindowFields, EditorId, ShadowNodeId} from '@/shell/edge/UI-edge/floating-windows/types';
import {cyFitWithRelativeZoom} from '@/utils/responsivePadding';
import * as O from 'fp-ts/lib/Option.js';

export async function createSettingsEditor(cy: Core): Promise<void> {
    const settingsId: EditorId = 'settings-editor' as EditorId;

    try {
        // Check if already exists
        const existing: HTMLElement | null = document.getElementById(`window-${settingsId}`);
        if (existing) {
            console.log('[createSettingsEditor] Settings editor already exists');
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

        // Create FloatingWindowFields for v2 createWindowChrome
        const settingsWindowFields: FloatingWindowFields = {
            anchoredToNodeId: O.none,
            title: 'Settings',
            resizable: true,
            shadowNodeDimensions: { width: 600, height: 400 },
        };

        // Create window chrome with CodeMirror editor
        const {windowElement, contentContainer} = createWindowChrome(cy, settingsWindowFields, settingsId);

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
                    // Could add visual error indicator here
                }
            })();
        });

        // Store editor instance for cleanup
        const vanillaInstances: Map<string, { dispose: () => void; }> = new Map<string, { dispose: () => void }>();
        vanillaInstances.set(settingsId, editor);

        // Fixed size in graph coordinates (does not adapt to zoom)
        const fixedWidth: number = 800;
        const fixedHeight: number = 600;

        // Position in center of current viewport
        const pan: Position = cy.pan();
        const zoom: number = cy.zoom();
        const centerX: number = (cy.width() / 2 - pan.x) / zoom;
        const centerY: number = (cy.height() / 2 - pan.y) / zoom;

        // Create shadow node for the settings editor (enables cyFitWithRelativeZoom)
        const shadowNodeId: ShadowNodeId = `shadow-${settingsId}` as ShadowNodeId;
        const shadowNode: cytoscape.CollectionReturnValue = cy.add({
            group: 'nodes',
            data: {
                id: shadowNodeId,
                isFloatingWindow: true,
                isShadowNode: true,
                windowType: 'Settings',
                laidOut: false
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

        // Position window centered on shadow node
        windowElement.style.left = `${centerX}px`;
        windowElement.style.top = `${centerY}px`;
        windowElement.style.width = `${fixedWidth}px`;
        windowElement.style.height = `${fixedHeight}px`;
        windowElement.style.transform = 'translate(-50%, -50%)';

        // Add to overlay
        overlay.appendChild(windowElement);

        // Zoom viewport so settings window takes 75% of viewport
        cyFitWithRelativeZoom(cy, shadowNode, 0.75);

        // Setup close button cleanup
        const closeButton: HTMLElement = windowElement.querySelector('.cy-floating-window-close') as HTMLElement;
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                editor.dispose();
                vanillaInstances.delete(settingsId);
                shadowNode.remove();
                windowElement.remove();
            });
        }

        console.log('[createSettingsEditor] Types editor created successfully');
    } catch (error) {
        console.error('[createSettingsEditor] Failed to create settings editor:', error);
    }
}
