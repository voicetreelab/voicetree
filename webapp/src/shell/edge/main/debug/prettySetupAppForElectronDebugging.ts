import { getGraph } from '@/shell/edge/main/state/graph-store';
import { spawnTerminalWithContextNode } from '@/shell/edge/main/terminals/spawnTerminalWithContextNode';
import { startFileWatching } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import type { NodeIdAndFilePath } from '@/pure/graph';
import path from 'path';
import { app } from 'electron';

export interface DebugSetupResult {
    terminalsSpawned: string[];
    nodeCount: number;
    projectLoaded?: string;
}

// Default test project path (relative to webapp)
const DEFAULT_TEST_PROJECT = 'example_folder_fixtures/example_small';

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
        // Resolve path relative to app resources (webapp directory in dev)
        const appPath = app.getAppPath();
        const testProjectPath = path.join(appPath, DEFAULT_TEST_PROJECT);

        console.log('[DebugSetup] No project loaded, auto-loading:', testProjectPath);

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
        // 1. Spawn parent terminal
        const { terminalId: parentTerminalId } = await spawnTerminalWithContextNode(
            candidates[0],
            'echo "hello from parent"',
            undefined, true, false
        );
        terminalIds.push(parentTerminalId);

        // 2. Spawn child terminal (mocks MCP spawn_agent)
        if (candidates.length > 1) {
            const { terminalId: childTerminalId } = await spawnTerminalWithContextNode(
                candidates[1],
                'echo "hello from child"',
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
                'echo "hello from sibling"',
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
