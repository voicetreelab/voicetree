/**
 * Create a floating settings editor window
 * Loads settings from IPC and allows editing them as JSON
 */

import type {} from '@/shell/electron';
import type {Core} from 'cytoscape';
import {createWindowChrome, getOrCreateOverlay} from '@/shell/UI/floating-windows/cytoscape-floating-windows';
import type {VTSettings} from '@/pure/settings/types';
import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView';

export async function createSettingsEditor(cy: Core): Promise<void> {
    const settingsId: "settings-editor" = 'settings-editor';

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

        // Create window chrome with CodeMirror editor
        const {windowElement, contentContainer} = createWindowChrome(cy, {
            id: settingsId,
            title: 'Types',
            component: 'MarkdownEditor',
            resizable: true,
            initialContent: settingsJson
        });

        // Create CodeMirror editor instance for JSON editing
        const editor: CodeMirrorEditorView = new CodeMirrorEditorView(
            contentContainer,
            settingsJson,
            {
                autosaveDelay: 300,
                darkMode: document.documentElement.classList.contains('dark')
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

        // Position window in center of current viewport (same as backup terminal)
        const pan: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/cytoscape/index").Position = cy.pan();
        const zoom: number = cy.zoom();
        const centerX: number = (cy.width() / 2 - pan.x) / zoom;
        const centerY: number = (cy.height() / 2 - pan.y) / zoom;

        const windowWidth: 600 = 600 as const;
        const windowHeight: 400 = 400 as const;
        windowElement.style.left = `${centerX - windowWidth / 2}px`;
        windowElement.style.top = `${centerY - windowHeight / 2}px`;
        windowElement.style.width = `${windowWidth}px`;
        windowElement.style.height = `${windowHeight}px`;

        // Add to overlay
        overlay.appendChild(windowElement);

        // Setup close button cleanup
        const closeButton: HTMLElement = windowElement.querySelector('.cy-floating-window-close') as HTMLElement;
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                editor.dispose();
                vanillaInstances.delete(settingsId);
                windowElement.remove();
            });
        }

        console.log('[createSettingsEditor] Types editor created successfully');
    } catch (error) {
        console.error('[createSettingsEditor] Failed to create settings editor:', error);
    }
}
