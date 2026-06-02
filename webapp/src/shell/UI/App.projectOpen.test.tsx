import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedProject } from '@vt/graph-model/project'

import App from './App'

const selectedProject: SavedProject = {
    id: 'project-1',
    path: '/tmp/vt-project',
    name: 'vt-project',
    type: 'folder',
    lastOpened: 1,
}

vi.mock('@/shell/UI/ProjectSelectionScreen', () => ({
    ProjectSelectionScreen: ({ onProjectSelected }: { onProjectSelected: (project: SavedProject) => void }) => (
        <button type="button" onClick={() => onProjectSelected(selectedProject)}>
            Open Project
        </button>
    ),
}))

vi.mock('@/shell/UI/views/hooks/useFolderWatcher', () => ({
    useFolderWatcher: () => ({
        watchDirectory: undefined,
        isWatching: false,
        startWatching: async () => undefined,
        stopWatching: async () => undefined,
    }),
}))

vi.mock('@/shell/edge/renderer/live/useEventSubscriptionConnection', () => ({
    useEventSubscriptionConnection: () => ({ isConnected: false }),
}))

vi.mock('@/shell/edge/UI-edge/graph/view/dotGridBackground', () => ({
    attachDotGridBackground: () => () => undefined,
}))

vi.mock('@/shell/UI/views/renderers/voicetree-transcribe', () => ({
    default: () => <div data-testid="transcribe" />,
}))

vi.mock('@/shell/UI/views/ui-controls/AgentStatsPanel', () => ({
    AgentStatsPanel: () => <div data-testid="agent-stats" />,
}))

vi.mock('@/shell/UI/views/components/ProjectPathSelector', () => ({
    ProjectPathSelector: () => <div data-testid="project-path-selector" />,
}))

vi.mock('@/shell/edge/UI-edge/components/ViewSwitcher', () => ({
    ViewSwitcher: () => <div data-testid="view-switcher" />,
}))

vi.mock('@/shell/UI/views/graph-view/VoiceTreeGraphView', () => ({
    VoiceTreeGraphView: class {
        dispose(): void {}
    },
}))

describe('App project-open lifecycle', () => {
    let calls: string[]

    beforeEach(() => {
        calls = []
        window.hostAPI = {
            main: {
                getStartupProjectHint: async () => {
                    calls.push('getStartupProjectHint')
                    return { kind: 'none' }
                },
                openProject: async (projectPath: string) => {
                    calls.push(`openProject:${projectPath}`)
                    return {
                        sessionId: 'session-1',
                        writeFolderPath: `${projectPath}/voicetree-29-5`,
                        projectState: { projectRoot: projectPath },
                        initialProjectedGraph: { nodes: [], edges: [] },
                        folderState: [],
                        activeView: { id: 'default', name: 'Default' },
                    }
                },
                saveProject: async (project: SavedProject) => {
                    calls.push(`saveProject:${project.path}`)
                },
                loadProjects: async () => [],
                loadSettings: async () => ({}),
            },
            onProjectSwitching: () => () => undefined,
            onProjectReady: () => () => undefined,
            onProjectLost: () => () => undefined,
            onViewSwitched: () => () => undefined,
            removeAllListeners: () => undefined,
            onBackendLog: () => undefined,
            graph: {
                getCurrentProjectedGraph: async () => ({ nodes: [], edges: [] }),
                onProjectedGraphUpdate: () => () => undefined,
                onGraphClear: () => () => undefined,
            },
            terminal: {},
            events: {},
            invoke: async () => undefined,
            on: () => undefined,
            off: () => undefined,
        } as unknown as Window['hostAPI']
    })

    afterEach(() => {
        cleanup()
        delete window.hostAPI
    })

    it('opens a selected project through one public project-open transition', async () => {
        render(<App />)

        fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))

        await waitFor(() => {
            expect(calls).toContain('openProject:/tmp/vt-project')
        })

        const openIndex: number = calls.indexOf('openProject:/tmp/vt-project')
        const saveIndex: number = calls.indexOf('saveProject:/tmp/vt-project')

        expect(calls.filter((call) => call.startsWith('openProject:'))).toEqual([
            'openProject:/tmp/vt-project',
        ])
        expect(saveIndex).toBeGreaterThan(openIndex)
        expect(calls.some((call) => call.startsWith('initializeProject'))).toBe(false)
    })
})
