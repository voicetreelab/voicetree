/**
 * Create a fixed-position settings overlay popup
 * Decoupled from the graph — doesn't create shadow nodes or interact with zoom/pan.
 */

import type {} from '@/shell/electron';
import type {Core} from 'cytoscape';
import type {VTSettings} from '@/pure/settings/types';
import type {EditorId} from '@/shell/edge/UI-edge/floating-windows/types';
import {vanillaFloatingWindowInstances} from '@/shell/edge/UI-edge/state/UIAppState';
import {X, createElement} from 'lucide';
import {createRoot, type Root} from 'react-dom/client';
import {createElement as reactCreateElement} from 'react';
import {SettingsEditor} from '@/shell/UI/views/components/settings/SettingsEditor';

const SETTINGS_EDITOR_ID: EditorId = 'settings-editor' as EditorId;
const SETTINGS_BACKDROP_ID: string = 'settings-overlay-backdrop';

/**
 * Create a simple title bar with macOS-style close button for the settings editor
 * Settings editor only needs close functionality (no pin/fullscreen)
 */
function createSettingsTitleBar(onClose: () => void): { titleBar: HTMLDivElement; titleText: HTMLSpanElement } {
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

    titleBar.appendChild(titleText);
    titleBar.appendChild(closeBtn);

    return { titleBar, titleText };
}

/**
 * Check if the settings editor is currently open
 */
export function isSettingsEditorOpen(): boolean {
    return vanillaFloatingWindowInstances.has(SETTINGS_EDITOR_ID);
}

/**
 * Close the settings editor if it exists.
 * React SettingsEditor auto-saves, so no JSON validation needed on close.
 * cy parameter kept for call-site compatibility.
 */
export function closeSettingsEditor(_cy: Core): void {
    const instance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(SETTINGS_EDITOR_ID);
    if (!instance) return;

    // Unmount React root
    instance.dispose();

    // Remove from global state
    vanillaFloatingWindowInstances.delete(SETTINGS_EDITOR_ID);

    // Remove DOM elements
    const windowElement: HTMLElement | null = document.getElementById(`window-${SETTINGS_EDITOR_ID}`);
    if (windowElement) windowElement.remove();

    const backdrop: HTMLElement | null = document.getElementById(SETTINGS_BACKDROP_ID);
    if (backdrop) backdrop.remove();
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

        // Create backdrop for click-outside-to-close
        const backdrop: HTMLDivElement = document.createElement('div');
        backdrop.id = SETTINGS_BACKDROP_ID;
        backdrop.className = 'settings-overlay-backdrop';
        backdrop.addEventListener('click', () => closeSettingsEditor(cy));

        // Create popup container — fixed position, centered on screen
        const windowElement: HTMLDivElement = document.createElement('div');
        windowElement.id = `window-${SETTINGS_EDITOR_ID}`;
        windowElement.className = 'settings-overlay-popup';

        // Prevent clicks inside the popup from closing via backdrop
        windowElement.addEventListener('mousedown', (e: MouseEvent): void => e.stopPropagation());

        // Title bar with close button
        const { titleBar }: { titleBar: HTMLDivElement; titleText: HTMLSpanElement } = createSettingsTitleBar(() => closeSettingsEditor(cy));
        windowElement.appendChild(titleBar);

        // Content container for React
        const contentContainer: HTMLDivElement = document.createElement('div');
        contentContainer.className = 'settings-overlay-content';
        windowElement.appendChild(contentContainer);

        // Mount React SettingsEditor
        const root: Root = createRoot(contentContainer);
        const saveFn: (updatedSettings: VTSettings) => Promise<void> = async (updatedSettings: VTSettings): Promise<void> => {
            if (window.electronAPI) {
                await window.electronAPI.main.saveSettings(updatedSettings);
            }
        };
        root.render(reactCreateElement(SettingsEditor, { initialSettings: settings, onSave: saveFn }));

        // Store dispose handle in global state for cleanup
        vanillaFloatingWindowInstances.set(SETTINGS_EDITOR_ID, { dispose: () => root.unmount() });

        // Append to document body — fully decoupled from graph
        document.body.appendChild(backdrop);
        document.body.appendChild(windowElement);
    } catch (error) {
        console.error('[createSettingsEditor] Failed to create settings editor:', error);
    }
}
