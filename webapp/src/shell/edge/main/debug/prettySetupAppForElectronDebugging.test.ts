import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockGetGraph,
    mockSpawnTerminalWithContextNode,
    mockLoadSettings,
    mockStartFileWatching,
    mockSaveProject,
} = vi.hoisted(() => ({
    mockGetGraph: vi.fn(),
    mockSpawnTerminalWithContextNode: vi.fn(),
    mockLoadSettings: vi.fn(),
    mockStartFileWatching: vi.fn(),
    mockSaveProject: vi.fn(),
}));

vi.mock('@/shell/edge/main/state/graph-store', () => ({
    getGraph: mockGetGraph,
}));

vi.mock('@/shell/edge/main/terminals/spawnTerminalWithContextNode', () => ({
    spawnTerminalWithContextNode: mockSpawnTerminalWithContextNode,
}));

vi.mock('@/shell/edge/main/settings/settings_IO', () => ({
    loadSettings: mockLoadSettings,
}));

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
    startFileWatching: mockStartFileWatching,
}));

vi.mock('@/shell/edge/main/project-store', () => ({
    saveProject: mockSaveProject,
}));

vi.mock('electron', () => ({
    app: {
        getAppPath: vi.fn(() => '/app'),
        isPackaged: false,
    },
}));

import { getGraph } from '@/shell/edge/main/state/graph-store';
import { spawnTerminalWithContextNode } from '@/shell/edge/main/terminals/spawnTerminalWithContextNode';
import { loadSettings } from '@/shell/edge/main/settings/settings_IO';
import { prettySetupAppForElectronDebugging } from './prettySetupAppForElectronDebugging';

type MinimalGraphNode = {
    nodeUIMetadata: {
        isContextNode: boolean;
    };
};

function buildGraph(): { nodes: Record<string, MinimalGraphNode> } {
    return {
        nodes: {
            '/tmp/node-1.md': { nodeUIMetadata: { isContextNode: false } },
            '/tmp/node-2.md': { nodeUIMetadata: { isContextNode: false } },
            '/tmp/node-3.md': { nodeUIMetadata: { isContextNode: false } },
            '/tmp/context.md': { nodeUIMetadata: { isContextNode: true } },
        },
    };
}

describe('prettySetupAppForElectronDebugging', () => {
    const fakeAgentCommand = `node tools/vt-fake-agent/dist/index.js "${process.platform === 'win32' ? '$env:AGENT_PROMPT' : '$AGENT_PROMPT'}"`;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.VT_DEBUG_REAL_AGENTS;

        vi.mocked(getGraph).mockReturnValue(buildGraph() as ReturnType<typeof getGraph>);
        vi.mocked(loadSettings).mockResolvedValue({
            agents: [
                { name: 'Claude', command: 'claude --dangerously-skip-permissions "$AGENT_PROMPT"' },
                { name: 'Fake Agent', command: fakeAgentCommand },
            ],
        });
        vi.mocked(spawnTerminalWithContextNode)
            .mockResolvedValueOnce({ terminalId: 'parent-terminal', contextNodeId: '/tmp/context-parent.md' })
            .mockResolvedValueOnce({ terminalId: 'child-terminal', contextNodeId: '/tmp/context-child.md' })
            .mockResolvedValueOnce({ terminalId: 'sibling-terminal', contextNodeId: '/tmp/context-sibling.md' });

        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('spawns seeded terminals with the fake agent command by default', async () => {
        expect(fakeAgentCommand).toBeTruthy();

        const result = await prettySetupAppForElectronDebugging();

        expect(loadSettings).toHaveBeenCalledOnce();
        expect(spawnTerminalWithContextNode).toHaveBeenCalledTimes(3);
        expect(spawnTerminalWithContextNode).toHaveBeenNthCalledWith(
            1,
            '/tmp/node-1.md',
            fakeAgentCommand,
            undefined,
            true,
            false,
        );
        expect(spawnTerminalWithContextNode).toHaveBeenNthCalledWith(
            2,
            '/tmp/node-2.md',
            fakeAgentCommand,
            undefined,
            true,
            false,
            undefined,
            undefined,
            'parent-terminal',
        );
        expect(spawnTerminalWithContextNode).toHaveBeenNthCalledWith(
            3,
            '/tmp/node-3.md',
            fakeAgentCommand,
            undefined,
            true,
            false,
        );
        expect(result).toEqual({
            terminalsSpawned: ['parent-terminal', 'child-terminal', 'sibling-terminal'],
            nodeCount: 4,
            projectLoaded: undefined,
        });
    });

    it('preserves real-agent spawning only behind VT_DEBUG_REAL_AGENTS=1', async () => {
        process.env.VT_DEBUG_REAL_AGENTS = '1';

        await prettySetupAppForElectronDebugging();

        expect(loadSettings).not.toHaveBeenCalled();
        expect(spawnTerminalWithContextNode).toHaveBeenNthCalledWith(
            1,
            '/tmp/node-1.md',
            undefined,
            undefined,
            true,
            false,
        );
    });

    it('fails closed instead of falling back to real agents when the fake agent entry is missing', async () => {
        vi.mocked(loadSettings).mockResolvedValue({
            agents: [
                { name: 'Claude', command: 'claude --dangerously-skip-permissions "$AGENT_PROMPT"' },
            ],
        });

        const result = await prettySetupAppForElectronDebugging();

        expect(spawnTerminalWithContextNode).not.toHaveBeenCalled();
        expect(result).toEqual({
            terminalsSpawned: [],
            nodeCount: 4,
            projectLoaded: undefined,
        });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Refusing to auto-spawn real agents'));
    });
});
