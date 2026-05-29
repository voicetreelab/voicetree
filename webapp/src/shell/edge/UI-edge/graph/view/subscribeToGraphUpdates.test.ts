// @vitest-environment jsdom

import cytoscape, { type Core } from 'cytoscape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectedGraph } from '@vt/graph-state/contract';
import type { ElectronAPI } from '@/shell/electron';
import { disposeGraphViewOverlays, initGraphViewOverlays, setLoadingState } from '@/shell/edge/UI-edge/state/stores/GraphViewUIStore';
import { getLatestProjectedGraph } from '@/shell/edge/UI-edge/state/stores/LatestProjectedGraphStore';
import type { GraphNavigationService } from '@/shell/edge/UI-edge/graph/navigation/GraphNavigationService';
import type { SearchService } from '@/shell/UI/views/graph-view/SearchService';

import { subscribeToGraphUpdates } from './subscribeToGraphUpdates';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

const PROJECTED_GRAPH: ProjectedGraph = {
    nodes: [],
    edges: [],
    rootPath: '/project',
    revision: 1,
    forests: [],
    arboricity: 0,
    recentNodeIds: [],
};

function setupLoadingOverlay(): HTMLDivElement {
    const loading: HTMLDivElement = document.createElement('div');
    const message: HTMLParagraphElement = document.createElement('p');
    const empty: HTMLDivElement = document.createElement('div');
    loading.append(message);
    document.body.append(loading, empty);
    initGraphViewOverlays(loading, message, empty);
    setLoadingState(true, 'Loading Voicetree...');
    return loading;
}

function installElectronAPI(projectedGraph: ProjectedGraph): void {
    window.electronAPI = {
        graph: {
            getCurrentProjectedGraph: async (): Promise<ProjectedGraph> => projectedGraph,
            onProjectedGraphUpdate: () => (): void => {},
            onGraphClear: () => (): void => {},
        },
    } as unknown as ElectronAPI;
}

function createNavigationService(cy: Core): GraphNavigationService {
    return {
        getCy: () => cy,
        setLastCreatedNodeId: () => {},
    } as unknown as GraphNavigationService;
}

function createSearchService(): SearchService {
    return {
        updateSearchData: () => {},
    } as unknown as SearchService;
}

async function flushPromiseQueue(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('subscribeToGraphUpdates', () => {
    let cy: Core | null = null;

    afterEach(() => {
        cy?.destroy();
        cy = null;
        disposeGraphViewOverlays();
        document.body.replaceChildren();
        Reflect.deleteProperty(window, 'electronAPI');
        vi.restoreAllMocks();
    });

    it('hydrates from the current projected graph after registering for live updates', async () => {
        const loading: HTMLDivElement = setupLoadingOverlay();
        installElectronAPI(PROJECTED_GRAPH);
        cy = cytoscape({ headless: true });

        const cleanup: (() => void) | null = subscribeToGraphUpdates(
            createNavigationService(cy),
            createSearchService(),
            () => {},
        );
        await flushPromiseQueue();

        expect(cleanup).not.toBeNull();
        expect(loading.style.display).toBe('none');
        expect(getLatestProjectedGraph()).toBe(PROJECTED_GRAPH);

        cleanup?.();
    });
});
