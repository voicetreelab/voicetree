import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
    mockBootstrapDaemonVaultFromLocalState,
    mockGetProjectRootWatchedDirectory,
    mockMarkFrontendReady,
    mockSetProjectRootWatchedDirectory,
    mockStartDaemonGraphSync,
    mockStartFileWatching,
    mockStopDaemonGraphSync,
    mockStopFileWatching,
    mockSyncWatchedProjectRoot,
    mockIsDaemonGraphSyncActive,
} = vi.hoisted(() => ({
    mockBootstrapDaemonVaultFromLocalState: vi.fn(),
    mockGetProjectRootWatchedDirectory: vi.fn(),
    mockMarkFrontendReady: vi.fn(),
    mockSetProjectRootWatchedDirectory: vi.fn(),
    mockStartDaemonGraphSync: vi.fn(),
    mockStartFileWatching: vi.fn(),
    mockStopDaemonGraphSync: vi.fn(),
    mockStopFileWatching: vi.fn(),
    mockSyncWatchedProjectRoot: vi.fn(),
    mockIsDaemonGraphSyncActive: vi.fn(),
}))

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getProjectRootWatchedDirectory: mockGetProjectRootWatchedDirectory,
        markFrontendReady: mockMarkFrontendReady,
        setProjectRootWatchedDirectory: mockSetProjectRootWatchedDirectory,
        startFileWatching: mockStartFileWatching,
        stopFileWatching: mockStopFileWatching,
    }
})

vi.mock('@/shell/edge/main/electron/daemon-watch-sync', () => ({
    isDaemonGraphSyncActive: mockIsDaemonGraphSyncActive,
    startDaemonGraphSync: mockStartDaemonGraphSync,
    stopDaemonGraphSync: mockStopDaemonGraphSync,
}))

vi.mock('@/shell/edge/main/electron/daemon-ipc-proxy', () => ({
    bootstrapDaemonVaultFromLocalState: mockBootstrapDaemonVaultFromLocalState,
}))

vi.mock('@/shell/edge/main/state/live-state-store', () => ({
    syncWatchedProjectRoot: mockSyncWatchedProjectRoot,
}))

import {
    getWatchStatus,
    markFrontendReady,
    startFileWatching,
    stopFileWatching,
} from './watchFolder'

describe('watchFolder daemon sync bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockGetProjectRootWatchedDirectory.mockReturnValue('/tmp/project-root')
        mockIsDaemonGraphSyncActive.mockReturnValue(true)
    })

    it('starts file watching through the daemon-backed load path', async () => {
        mockStartFileWatching.mockResolvedValue({
            success: true,
            directory: '/tmp/project-root',
        })

        const result = await startFileWatching('/tmp/project-root')

        expect(result).toEqual({
            success: true,
            directory: '/tmp/project-root',
        })
        expect(mockStartFileWatching).toHaveBeenCalledWith('/tmp/project-root', {
            mountWatcher: false,
        })
        expect(mockBootstrapDaemonVaultFromLocalState).toHaveBeenCalledWith('/tmp/project-root')
        expect(mockStartDaemonGraphSync).toHaveBeenCalledWith('/tmp/project-root')
        expect(mockSyncWatchedProjectRoot).toHaveBeenCalledWith('/tmp/project-root')
    })

    it('stops daemon sync and clears the loaded root on teardown', async () => {
        mockStopFileWatching.mockResolvedValue({ success: true })

        const result = await stopFileWatching()

        expect(result).toEqual({ success: true })
        expect(mockStopDaemonGraphSync).toHaveBeenCalledTimes(1)
        expect(mockStopFileWatching).toHaveBeenCalledTimes(1)
        expect(mockSetProjectRootWatchedDirectory).toHaveBeenCalledWith(null)
        expect(mockSyncWatchedProjectRoot).toHaveBeenCalledWith(null)
    })

    it('bootstraps frontend readiness without mounting a local watcher', async () => {
        mockMarkFrontendReady.mockResolvedValue(undefined)

        await markFrontendReady()

        expect(mockMarkFrontendReady).toHaveBeenCalledWith({
            mountWatcher: false,
        })
        expect(mockBootstrapDaemonVaultFromLocalState).toHaveBeenCalledWith('/tmp/project-root')
        expect(mockStartDaemonGraphSync).toHaveBeenCalledWith('/tmp/project-root')
        expect(mockSyncWatchedProjectRoot).toHaveBeenCalledWith('/tmp/project-root')
    })

    it('reports daemon sync ownership in watch status', () => {
        expect(getWatchStatus()).toEqual({
            isWatching: true,
            directory: '/tmp/project-root',
        })

        mockIsDaemonGraphSyncActive.mockReturnValue(false)

        expect(getWatchStatus()).toEqual({
            isWatching: false,
            directory: '/tmp/project-root',
        })
    })
})
