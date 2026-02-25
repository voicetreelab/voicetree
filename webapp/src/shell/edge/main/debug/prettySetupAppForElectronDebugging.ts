import { getGraph } from '@/shell/edge/main/state/graph-store';
import { spawnTerminalWithContextNode } from '@/shell/edge/main/terminals/spawnTerminalWithContextNode';
import { startFileWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import { saveProject } from '@/shell/edge/main/project-store';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { SavedProject } from '@/pure/project/types';
import * as path from 'path';
import { app } from 'electron';

export interface DebugSetupResult {
    terminalsSpawned: string[];
    nodeCount: number;
    projectLoaded?: string;
}

// Default test project folder name (in public/ for dev, extraResources for prod)
const DEFAULT_TEST_PROJECT = 'example_small';

/**
 * Get the example_small test fixture path.
 * In dev: webapp/public/example_small
 * In prod: resources/example_small (requires extraResources in package.json)
 */
function getTestProjectPath(): string {
    const appPath = app.getAppPath();
    if (app.isPackaged) {
        return path.join(process.resourcesPath, DEFAULT_TEST_PROJECT);
    } else {
        return path.join(appPath, 'public', DEFAULT_TEST_PROJECT);
    }
}

/**
 * Sets up a debug environment for Playwright MCP agents.
 *
 * If no project is loaded, automatically loads the example_small test fixture.
 * Then spawns 3 terminals: parent, child (indented), and sibling.
 * The child terminal has parentTerminalId set to test tree-style tabs indentation.
 */
export async function prettySetupAppForElectronDebugging(): Promise<DebugSetupResult> {
    let graph = getGraph();
    let nodeIds = Object.keys(graph.nodes) as NodeIdAndFilePath[];
    let projectLoaded: string | undefined;

    // If no nodes loaded, auto-load the test project
    if (nodeIds.length === 0) {
        const testProjectPath = getTestProjectPath();

        console.log('[DebugSetup] No project loaded, auto-loading:', testProjectPath);

        // Create and save a real project (same flow as UI)
        const project: SavedProject = {
            id: `debug-example-small`,
            path: testProjectPath,
            name: 'example_small',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true  // example_small is already a voicetree folder
        };
        await saveProject(project);
        console.log('[DebugSetup] Saved project:', project.id);

        const result = await startFileWatching(testProjectPath);
        if (!result.success) {
            console.error('[DebugSetup] Failed to load test project:', result.error);
            return { terminalsSpawned: [], nodeCount: 0 };
        }

        projectLoaded = result.directory;

        // Wait a moment for graph to populate
        await new Promise(resolve => setTimeout(resolve, 500));

        // Refresh graph reference
        graph = getGraph();
        nodeIds = Object.keys(graph.nodes) as NodeIdAndFilePath[];
        console.log('[DebugSetup] Project loaded, node count:', nodeIds.length);
    }

    const candidates = nodeIds
        .filter(id => !graph.nodes[id].nodeUIMetadata.isContextNode)
        .slice(0, 3);

    if (candidates.length === 0) {
        return { terminalsSpawned: [], nodeCount: nodeIds.length };
    }

    const terminalIds: string[] = [];

    try {
        // 1. Spawn parent terminal (undefined command = use first agent from settings)
        const { terminalId: parentTerminalId } = await spawnTerminalWithContextNode(
            candidates[0],
            undefined,
            undefined, true, false
        );
        terminalIds.push(parentTerminalId);

        // 2. Spawn child terminal (mocks MCP spawn_agent)
        if (candidates.length > 1) {
            const { terminalId: childTerminalId } = await spawnTerminalWithContextNode(
                candidates[1],
                undefined,
                undefined, true, false,
                undefined,  // selectedNodeIds
                undefined,  // spawnDirectory
                parentTerminalId  // parentTerminalId for tree indentation
            );
            terminalIds.push(childTerminalId);
        }

        // 3. Spawn sibling terminal (another root)
        if (candidates.length > 2) {
            const { terminalId } = await spawnTerminalWithContextNode(
                candidates[2],
                undefined,
                undefined, true, false
            );
            terminalIds.push(terminalId);
        }
    } catch (err) {
        console.error('[DebugSetup] Failed to spawn terminal:', err);
    }

    return {
        terminalsSpawned: terminalIds,
        nodeCount: nodeIds.length,
        projectLoaded
    };
}
