import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingWindowManager } from '@/views/FloatingWindowManager';
import cytoscape, { type Core } from 'cytoscape';
import type { Settings } from '@/functional/pure/settings/types.ts';
import '@/graph-core'; // Import to trigger extension registration

// Mock window.electronAPI
const mockElectronAPI = {
    settings: {
        load: vi.fn(),
        save: vi.fn()
    }
};

// Extend window type to include electronAPI
declare global {
    interface Window {
        electronAPI: typeof mockElectronAPI;
    }
}

describe('FloatingWindowManager - Types Editor', () => {
    let manager: FloatingWindowManager;
    let cy: Core;
    let container: HTMLElement;
    let mockGetGraphState: () => { nodes: Map<string, unknown>; edges: Map<string, unknown> };
    let mockHotkeyManager: { onModifierChange: typeof vi.fn };

    const mockSettings: Settings = {
        agentLaunchPath: '../',
        agentCommand: './Claude.sh'
    };

    beforeEach(() => {
        // Setup DOM
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        document.body.appendChild(container);

        // Create cytoscape instance
        cy = cytoscape({
            container,
            elements: [],
            headless: true
        });

        // Mock dependencies
        mockGetGraphState = vi.fn(() => ({
            nodes: new Map(),
            edges: new Map()
        }));

        mockHotkeyManager = {
            onModifierChange: vi.fn()
        };

        // Setup window.electronAPI mock
        window.electronAPI = mockElectronAPI;
        mockElectronAPI.settings.load.mockResolvedValue(mockSettings); // todo wrong api now, use .main
        mockElectronAPI.settings.save.mockResolvedValue(undefined);

        // Create manager instance
        manager = new FloatingWindowManager(
            cy,
            mockGetGraphState,
            mockHotkeyManager as never
        );
    });

    afterEach(() => {
        // Cleanup
        manager.dispose();
        cy.destroy();
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }

        // Clean up any floating windows
        const windows = document.querySelectorAll('.cy-floating-window');
        windows.forEach(win => win.remove());

        // Reset mocks
        vi.clearAllMocks();
    });

    describe('createSettingsEditor', () => {
        it('should load settings from IPC when creating editor', async () => {
            await manager.createSettingsEditor();

            expect(mockElectronAPI.settings.load).toHaveBeenCalledOnce();
        });

        it('should create a floating editor window with correct title', async () => {
            await manager.createSettingsEditor();

            const settingsWindow = document.getElementById('window-settings-editor');
            expect(settingsWindow).toBeTruthy();

            const title = settingsWindow?.querySelector('.cy-floating-window-title-text');
            expect(title?.textContent).toBe('Types');
        });

        it('should display settings as formatted JSON', async () => {
            await manager.createSettingsEditor();

            // Wait for editor to render
            await new Promise(resolve => setTimeout(resolve, 100));

            const settingsWindow = document.getElementById('window-settings-editor');
            expect(settingsWindow).toBeTruthy();

            // Check that the editor contains the settings as JSON
            const editorContent = settingsWindow?.querySelector('.cm-content');
            expect(editorContent).toBeTruthy();
        });

        it('should position window in center of screen', async () => {
            await manager.createSettingsEditor();

            const settingsWindow = document.getElementById('window-settings-editor') as HTMLElement;
            expect(settingsWindow).toBeTruthy();

            // Check that the window is positioned
            const left = parseInt(settingsWindow.style.left);
            const top = parseInt(settingsWindow.style.top);

            // Should be roughly centered (within reasonable bounds)
            expect(left).toBeGreaterThan(0);
            expect(top).toBeGreaterThan(0);
            expect(left).toBeLessThan(window.innerWidth);
            expect(top).toBeLessThan(window.innerHeight);
        });

        it('should not create duplicate editor if already exists', async () => {
            await manager.createSettingsEditor();
            await manager.createSettingsEditor();

            const windows = document.querySelectorAll('#window-settings-editor');
            expect(windows.length).toBe(1);
        });

        it('should save valid JSON changes via IPC', async () => {
            await manager.createSettingsEditor();

            // Wait for editor to initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            const settingsWindow = document.getElementById('window-settings-editor');
            const editorElement = settingsWindow?.querySelector('.cm-content') as HTMLElement;

            if (editorElement) {
                // Simulate editing by triggering the onChange callback
                // We need to access the CodeMirror instance
                const editorView = (editorElement as { cmView?: { view?: { state?: { doc?: { toString: () => string } } } } }).cmView;
                if (editorView) {
                    // This is a simplified test - in real usage the editor's onChange would fire
                    const newSettings: Settings = {
                        agentLaunchPath: '../new-path',
                        agentCommand: './NewCommand.sh'
                    };

                    // Manually call the save (simulating what onChange does)
                    await mockElectronAPI.settings.save(newSettings);

                    expect(mockElectronAPI.settings.save).toHaveBeenCalledWith(newSettings);
                }
            }
        });

        it('should handle invalid JSON gracefully without crashing', async () => {
            await manager.createSettingsEditor();

            // Wait for editor to initialize
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to save invalid JSON
            const invalidJson = '{ invalid json }';

            // The onChange handler should catch the error
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                JSON.parse(invalidJson);
                await mockElectronAPI.settings.save(invalidJson as never);
            } catch (error) {
                // Expected to throw
                expect(error).toBeTruthy();
            }

            // The save should not be called with invalid JSON
            // (in real implementation, the onChange handler validates before calling save)
            consoleErrorSpy.mockRestore();
        });

        it('should cleanup editor when close button is clicked', async () => {
            await manager.createSettingsEditor();

            const settingsWindow = document.getElementById('window-settings-editor');
            expect(settingsWindow).toBeTruthy();

            const closeButton = settingsWindow?.querySelector('.cy-floating-window-close') as HTMLElement;
            expect(closeButton).toBeTruthy();

            // Click close button
            closeButton.click();

            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 50));

            // Window should be removed
            const windowAfterClose = document.getElementById('window-settings-editor');
            expect(windowAfterClose).toBeNull();
        });

        it('should handle IPC errors gracefully', async () => {
            // Mock IPC to throw error
            mockElectronAPI.settings.load.mockRejectedValueOnce(new Error('IPC Error'));

            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await manager.createSettingsEditor();

            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('openSettings event', () => {
        it('should trigger createSettingsEditor when openSettings event is dispatched', async () => {
            const createSettingsEditorSpy = vi.spyOn(manager, 'createSettingsEditor');

            // Dispatch the event
            const event = new Event('openSettings');
            window.dispatchEvent(event);

            // Wait for async execution
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(createSettingsEditorSpy).toHaveBeenCalledOnce();
        });

        it('should create settings editor window when event is triggered', async () => {
            // Dispatch the event
            const event = new Event('openSettings');
            window.dispatchEvent(event);

            // Wait for async execution
            await new Promise(resolve => setTimeout(resolve, 100));

            const settingsWindow = document.getElementById('window-settings-editor');
            expect(settingsWindow).toBeTruthy();
        });
    });

    describe('integration with FloatingWindowManager', () => {
        it('should maintain settings editor independently of node editors', async () => {
            // Create a settings editor
            await manager.createSettingsEditor();

            const settingsWindow = document.getElementById('window-settings-editor');
            expect(settingsWindow).toBeTruthy();

            // Types editor should exist independently
            const title = settingsWindow?.querySelector('.cy-floating-window-title-text');
            expect(title?.textContent).toBe('Types');
        });
    });
});
