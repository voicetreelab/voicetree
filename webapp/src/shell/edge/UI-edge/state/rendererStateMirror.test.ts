// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderTreeNode } from '@vt/graph-model'
import type { SerializedState } from '@vt/graph-state'

function makeFolderTree(absolutePath: string): FolderTreeNode {
    return {
        name: 'vault',
        absolutePath,
        loadState: 'loaded',
        isWriteTarget: true,
        children: [
            {
                name: 'docs',
                absolutePath: `${absolutePath}/docs`,
                loadState: 'loaded',
                isWriteTarget: true,
                children: [
                    {
                        name: 'readme.md',
                        absolutePath: `${absolutePath}/docs/readme.md`,
                        isInGraph: false,
                    },
                ],
            },
        ],
    }
}

function makeSerializedLiveStateSnapshot(absolutePath: string): SerializedState {
    return {
        graph: {
            nodes: {},
            incomingEdgesIndex: [],
            nodeByBaseName: [],
            unresolvedLinksIndex: [],
        },
        roots: {
            loaded: [absolutePath],
            folderTree: [makeFolderTree(absolutePath)],
        },
        collapseSet: [],
        selection: [],
        layout: {
            positions: [],
        },
        meta: {
            schemaVersion: 1,
            revision: 1,
        },
    }
}

describe('rendererStateMirror', () => {
    beforeEach(() => {
        vi.resetModules()
        localStorage.clear()
        delete (window as unknown as { cytoscapeInstance?: unknown }).cytoscapeInstance
        delete (window as Window & typeof globalThis & { electronAPI?: unknown }).electronAPI
    })

    afterEach(() => {
        localStorage.clear()
        delete (window as unknown as { cytoscapeInstance?: unknown }).cytoscapeInstance
        delete (window as Window & typeof globalThis & { electronAPI?: unknown }).electronAPI
        vi.restoreAllMocks()
    })

    it('projects no folder nodes when no folder tree has been synced', async () => {
        const mirror = await import('@/shell/edge/UI-edge/state/rendererStateMirror')

        const spec = mirror.projectRendererState()

        expect(spec.nodes.filter((node) => node.kind === 'folder' || node.kind === 'folder-collapsed')).toHaveLength(0)
    })

    it('projects synced folder trees as roots on the renderer mirror', async () => {
        const mirror = await import('@/shell/edge/UI-edge/state/rendererStateMirror')
        const folderTreeStore = await import('@/shell/edge/UI-edge/state/FolderTreeStore')

        folderTreeStore.syncFolderTreeFromMain(makeFolderTree('/vault'))

        const spec = mirror.projectRendererState()

        expect(spec.revision).toBe(1)
        expect(
            spec.nodes.find((node) => node.id === '/vault/docs/' && node.kind === 'folder')
        ).toBeDefined()
    })

    it('projects folder trees from main snapshots when the renderer store is empty', async () => {
        const getLiveStateSnapshot = vi
            .fn<() => Promise<SerializedState>>()
            .mockResolvedValue(makeSerializedLiveStateSnapshot('/vault'))

        ;(window as Window & typeof globalThis & {
            electronAPI?: { main?: { getLiveStateSnapshot?: () => Promise<SerializedState> } }
        }).electronAPI = {
            main: {
                getLiveStateSnapshot,
            },
        }

        const mirror = await import('@/shell/edge/UI-edge/state/rendererStateMirror')

        await vi.waitFor(() => {
            const spec = mirror.projectRendererState()
            expect(spec.revision).toBe(1)
            expect(
                spec.nodes.find((node) => node.id === '/vault/docs/' && node.kind === 'folder')
            ).toBeDefined()
        })

        expect(getLiveStateSnapshot).toHaveBeenCalledTimes(1)
    })
})
