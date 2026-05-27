import { getGraphThroughDaemon } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries';
import { getVtDaemonFacade } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding';
import { openVault } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import { saveProject } from '@/shell/edge/main/workspace/project-store';
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { getAppSupportPath } from '@/shell/edge/main/runtime/state/app-electron-state';
import { createEmptyGraph, type Graph, type NodeIdAndFilePath } from '@vt/graph-model/graph';
import type { SavedProject } from '@vt/graph-model/project';
import * as path from 'path';
import { app } from 'electron';
import fsSync from 'fs';

export interface DebugSetupResult {
    terminalsSpawned: string[];
    nodeCount: number;
    projectLoaded?: string;
}

// Default test project folder name (in public/ for dev, extraResources for prod)
const DEFAULT_TEST_PROJECT = 'example_small';
const DEBUG_PROJECT_DIR_ENV = 'VT_DEBUG_PROJECT_DIR';
const DEBUG_REAL_AGENTS_ENV = 'VT_DEBUG_REAL_AGENTS';
const FAKE_AGENT_NAME = 'Fake Agent';
const FAKE_AGENT_COMMAND_FRAGMENT = 'tools/vt-fake-agent/dist/index.js';
const AGENT_PROMPT_VAR = process.platform === 'win32' ? '$env:AGENT_PROMPT' : '$AGENT_PROMPT';
const DEFAULT_FAKE_AGENT_COMMAND = `node ${FAKE_AGENT_COMMAND_FRAGMENT} "${AGENT_PROMPT_VAR}"`;

/**
 * Get the example_small test fixture path.
 * In dev: webapp/public/example_small
 * In prod: resources/example_small (requires extraResources in package.json)
 */
function getFallbackTestProjectPath(): string {
    const appPath = app.getAppPath();
    if (app.isPackaged) {
        return path.join(process.resourcesPath, DEFAULT_TEST_PROJECT);
    } else {
        return path.join(appPath, 'public', DEFAULT_TEST_PROJECT);
    }
}

function resolveDebugProjectPath(env: NodeJS.ProcessEnv = process.env): string {
    const overridePath = env[DEBUG_PROJECT_DIR_ENV]?.trim();

    if (overridePath) {
        if (fsSync.existsSync(overridePath)) {
            return overridePath;
        }

        console.warn(`[DebugSetup] ${DEBUG_PROJECT_DIR_ENV} does not exist, falling back:`, overridePath);
    }

    return getFallbackTestProjectPath();
}

type AgentCommandConfig = {
    readonly name: string;
    readonly command: string;
};

function findFakeAgentCommand(agents: readonly AgentCommandConfig[] | undefined): string | undefined {
    return agents?.find((agent: AgentCommandConfig) =>
        agent.name === FAKE_AGENT_NAME || agent.command.includes(FAKE_AGENT_COMMAND_FRAGMENT)
    )?.command;
}

async function resolvePrettySetupAgentCommand(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined | null> {
    if (env[DEBUG_REAL_AGENTS_ENV]?.trim() === '1') {
        return undefined;
    }

    const settings = await loadSettings(getAppSupportPath());
    const fakeAgentCommand = findFakeAgentCommand(settings.agents);

    if (fakeAgentCommand) {
        return fakeAgentCommand;
    }

    console.error(
        `[DebugSetup] Fake agent command not found in settings.agents. Refusing to auto-spawn real agents during vt-debug boot. ` +
        `Restore the fake agent (${DEFAULT_FAKE_AGENT_COMMAND}) or set ${DEBUG_REAL_AGENTS_ENV}=1 to opt in to real agents.`
    );
    return null;
}

async function getDebugGraph(): Promise<Graph> {
    try {
        return await getGraphThroughDaemon();
    } catch {
        return createEmptyGraph();
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
    let graph = await getDebugGraph();
    let nodeIds = Object.keys(graph.nodes) as NodeIdAndFilePath[];
    let projectLoaded: string | undefined;

    // If no nodes loaded, auto-load the test project
    if (nodeIds.length === 0) {
        const testProjectPath = resolveDebugProjectPath();
        const projectName = path.basename(testProjectPath);

        console.log('[DebugSetup] No project loaded, auto-loading:', testProjectPath);

        // Create and save a real project (same flow as UI)
        const project: SavedProject = {
            id: `debug-${projectName}`,
            path: testProjectPath,
            name: projectName,
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true
        };
        await saveProject(getAppSupportPath(), project);
        console.log('[DebugSetup] Saved project:', project.id);

        try {
            await openVault(testProjectPath);
        } catch (err: unknown) {
            console.error('[DebugSetup] Failed to load test project:', err);
            return { terminalsSpawned: [], nodeCount: 0 };
        }

        projectLoaded = testProjectPath;

        // Wait a moment for graph to populate
        await new Promise(resolve => setTimeout(resolve, 500));

        // Refresh graph reference
        graph = await getDebugGraph();
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
    const agentCommand = await resolvePrettySetupAgentCommand();

    if (agentCommand === null) {
        return { terminalsSpawned: [], nodeCount: nodeIds.length, projectLoaded };
    }

    try {
        const facade = getVtDaemonFacade();

        // 1. Spawn parent terminal (fake agent by default; real agents require explicit opt-in)
        const { terminalId: parentTerminalId } = await facade.terminals.spawnTerminalWithContextNode({
            taskNodeId: candidates[0],
            agentCommand,
            skipFitAnimation: true,
            startUnpinned: false,
        });
        terminalIds.push(parentTerminalId);

        // 2. Spawn child terminal (mocks MCP spawn_agent)
        if (candidates.length > 1) {
            const { terminalId: childTerminalId } = await facade.terminals.spawnTerminalWithContextNode({
                taskNodeId: candidates[1],
                agentCommand,
                skipFitAnimation: true,
                startUnpinned: false,
                parentTerminalId,
            });
            terminalIds.push(childTerminalId);
        }

        // 3. Spawn sibling terminal (another root)
        if (candidates.length > 2) {
            const { terminalId } = await facade.terminals.spawnTerminalWithContextNode({
                taskNodeId: candidates[2],
                agentCommand,
                skipFitAnimation: true,
                startUnpinned: false,
            });
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
