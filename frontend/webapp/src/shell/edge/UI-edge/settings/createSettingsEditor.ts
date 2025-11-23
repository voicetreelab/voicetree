/**
 * Create a floating settings editor window
 * Loads settings from IPC and allows editing them as JSON
 */

import type {} from '@/utils/types/electron';
import type {Core} from 'cytoscape';
import {createWindowChrome, getOrCreateOverlay} from '@/shell/UI/floating-windows/cytoscape-floating-windows.ts';
import type {Settings} from '@/pure/settings/types.ts';
import {CodeMirrorEditorView} from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView.ts';

export async function createSettingsEditor(cy: Core): Promise<void> {
    const settingsId = 'settings-editor';

    try {
        // Check if already exists
        const existing = document.getElementById(`window-${settingsId}`);
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
        const settings = await window.electronAPI.main.loadSettings() as Settings;
        const settingsJson = JSON.stringify(settings, null, 2);

        // Get overlay
        const overlay = getOrCreateOverlay(cy);

        // Create window chrome with CodeMirror editor
        const {windowElement, contentContainer} = createWindowChrome(cy, {
            id: settingsId,
            title: 'Types',
            component: 'MarkdownEditor',
            resizable: true,
            initialContent: settingsJson
        });

        // Create CodeMirror editor instance for JSON editing
        const editor = new CodeMirrorEditorView(
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
                    const parsedSettings = JSON.parse(newContent) as Settings;

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
        const vanillaInstances = new Map<string, { dispose: () => void }>();
        vanillaInstances.set(settingsId, editor);

        // Position window in center of current viewport (same as backup terminal)
        const pan = cy.pan();
        const zoom = cy.zoom();
        const centerX = (cy.width() / 2 - pan.x) / zoom;
        const centerY = (cy.height() / 2 - pan.y) / zoom;

        const windowWidth = 600;
        const windowHeight = 400;
        windowElement.style.left = `${centerX - windowWidth / 2}px`;
        windowElement.style.top = `${centerY - windowHeight / 2}px`;
        windowElement.style.width = `${windowWidth}px`;
        windowElement.style.height = `${windowHeight}px`;

        // Add to overlay
        overlay.appendChild(windowElement);

        // Setup close button cleanup
        const closeButton = windowElement.querySelector('.cy-floating-window-close') as HTMLElement;
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
