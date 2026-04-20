import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const mockUseFolderWatcher = vi.fn();

vi.mock('@/shell/UI/views/hooks/useFolderWatcher', () => ({
    useFolderWatcher: () => mockUseFolderWatcher(),
}));

vi.mock('@/shell/UI/views/renderers/voicetree-transcribe', () => ({
    default: () => <div data-testid="graph-view">graph-view</div>,
}));

vi.mock('@/shell/UI/views/VoiceTreeGraphView', () => ({
    VoiceTreeGraphView: class {
        dispose(): void {}
    },
}));

vi.mock('@/shell/UI/views/AgentStatsPanel', () => ({
    AgentStatsPanel: () => <div data-testid="agent-stats-panel" />,
}));

vi.mock('@/shell/UI/views/components/VaultPathSelector', () => ({
    VaultPathSelector: () => <div data-testid="vault-path-selector" />,
}));

vi.mock('@/shell/UI/ProjectSelectionScreen', () => ({
    ProjectSelectionScreen: () => <div data-testid="project-selection">project-selection</div>,
}));

type MockElectronAPI = {
    main: {
        getWatchStatus: ReturnType<typeof vi.fn>;
        loadPreviousFolder: ReturnType<typeof vi.fn>;
        loadProjects: ReturnType<typeof vi.fn>;
        startFileWatching: ReturnType<typeof vi.fn>;
        stopFileWatching: ReturnType<typeof vi.fn>;
        loadSettings: ReturnType<typeof vi.fn>;
    };
    onWatchingStarted: ReturnType<typeof vi.fn>;
};

function installElectronAPIMock(overrides: Partial<MockElectronAPI['main']> = {}): MockElectronAPI {
    const electronAPI: MockElectronAPI = {
        main: {
            getWatchStatus: vi.fn().mockResolvedValue({ isWatching: false, directory: undefined }),
            loadPreviousFolder: vi.fn().mockResolvedValue({ success: false }),
            loadProjects: vi.fn().mockResolvedValue([]),
            startFileWatching: vi.fn().mockResolvedValue({ success: true, directory: '/tmp/example_small' }),
            stopFileWatching: vi.fn().mockResolvedValue({ success: true }),
            loadSettings: vi.fn().mockResolvedValue({}),
            ...overrides,
        },
        onWatchingStarted: vi.fn(() => () => {}),
    };

    Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        writable: true,
        value: electronAPI,
    });

    return electronAPI;
}

describe('App bootstrap', () => {
    beforeEach(() => {
        mockUseFolderWatcher.mockReturnValue({
            watchDirectory: '/tmp/example_small',
            isWatching: true,
            isLoading: false,
            error: null,
            isElectron: true,
            startWatching: vi.fn(),
            stopWatching: vi.fn(),
            clearError: vi.fn(),
        });
    });

    afterEach(() => {
        delete (window as Window & { electronAPI?: unknown }).electronAPI;
    });

    it('opens graph view when main is already watching a project before renderer listeners attach', async () => {
        const electronAPI = installElectronAPIMock({
            getWatchStatus: vi.fn().mockResolvedValue({
                isWatching: true,
                directory: '/tmp/example_small',
            }),
            loadProjects: vi.fn().mockResolvedValue([
                {
                    id: 'saved-project',
                    path: '/tmp/example_small',
                    name: 'example_small',
                    type: 'folder',
                    lastOpened: Date.now(),
                    voicetreeInitialized: true,
                },
            ]),
        });

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('graph-view')).toBeInTheDocument();
        });

        expect(screen.queryByTestId('project-selection')).not.toBeInTheDocument();
        expect(electronAPI.main.loadPreviousFolder).not.toHaveBeenCalled();
        expect(electronAPI.main.startFileWatching).not.toHaveBeenCalled();
    });

    it('opens graph view from loadPreviousFolder without reloading the same project again', async () => {
        const electronAPI = installElectronAPIMock({
            loadPreviousFolder: vi.fn().mockResolvedValue({
                success: true,
                directory: '/tmp/example_small',
            }),
        });

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId('graph-view')).toBeInTheDocument();
        });

        expect(screen.queryByTestId('project-selection')).not.toBeInTheDocument();
        expect(electronAPI.main.loadPreviousFolder).toHaveBeenCalledOnce();
        expect(electronAPI.main.startFileWatching).not.toHaveBeenCalled();
    });

    it('bootstraps once electronAPI appears after the first render', async () => {
        render(<App />);

        installElectronAPIMock({
            getWatchStatus: vi.fn().mockResolvedValue({
                isWatching: true,
                directory: '/tmp/example_small',
            }),
            loadProjects: vi.fn().mockResolvedValue([
                {
                    id: 'saved-project',
                    path: '/tmp/example_small',
                    name: 'example_small',
                    type: 'folder',
                    lastOpened: Date.now(),
                    voicetreeInitialized: true,
                },
            ]),
        });

        await waitFor(() => {
            expect(screen.getByTestId('graph-view')).toBeInTheDocument();
        });

        expect(screen.queryByTestId('project-selection')).not.toBeInTheDocument();
    });
});
