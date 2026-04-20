import {describe, expect, it, vi} from 'vitest'

import {hydrateState} from '@vt/graph-state'
import {liveView} from '../src/live'
import {createLiveTransport} from '../src/liveTransport'

vi.mock('../src/liveTransport', async () => {
    const actual = await vi.importActual<typeof import('../src/liveTransport')>('../src/liveTransport')
    return {
        ...actual,
        createLiveTransport: vi.fn(),
    }
})

const VAULT_ROOT = '/tmp/vt-live-view-no-disk'
const ROOT_NODE = `${VAULT_ROOT}/root.md`
const TASKS_FOLDER = `${VAULT_ROOT}/tasks/`
const TASK_ONE = `${TASKS_FOLDER}task-1.md`
const TASK_TWO = `${TASKS_FOLDER}task-2.md`

const FIXTURE_SERIALIZED_STATE = {
    graph: {
        nodes: {
            [ROOT_NODE]: {
                outgoingEdges: [{targetId: TASK_ONE, label: ''}],
                absoluteFilePathIsID: ROOT_NODE,
                contentWithoutYamlOrLinks: '# Root\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
            [TASK_ONE]: {
                outgoingEdges: [{targetId: ROOT_NODE, label: ''}],
                absoluteFilePathIsID: TASK_ONE,
                contentWithoutYamlOrLinks: '# Task 1\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
            [TASK_TWO]: {
                outgoingEdges: [],
                absoluteFilePathIsID: TASK_TWO,
                contentWithoutYamlOrLinks: '# Task 2\n',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'None'},
                    additionalYAMLProps: [],
                },
            },
        },
        incomingEdgesIndex: [],
        nodeByBaseName: [],
        unresolvedLinksIndex: [],
    },
    roots: {
        loaded: [VAULT_ROOT],
        folderTree: [{
            name: 'vt-live-view-no-disk',
            absolutePath: VAULT_ROOT,
            children: [{
                name: 'tasks',
                absolutePath: TASKS_FOLDER.slice(0, -1),
                children: [],
                loadState: 'loaded' as const,
                isWriteTarget: true,
            }],
            loadState: 'loaded' as const,
            isWriteTarget: true,
        }],
    },
    collapseSet: [TASKS_FOLDER],
    selection: [],
    layout: {positions: [] as [string, {x: number; y: number}][]},
    meta: {schemaVersion: 1 as const, revision: 7, mutatedAt: '2026-04-19T00:00:00.000Z'},
}

describe('liveView', () => {
    it('renders from projected live state without rescanning the filesystem', async () => {
        vi.mocked(createLiveTransport).mockReturnValue({
            getLiveState: async () => hydrateState({
                ...FIXTURE_SERIALIZED_STATE,
                roots: {
                    ...FIXTURE_SERIALIZED_STATE.roots,
                    folderTree: [{
                        ...FIXTURE_SERIALIZED_STATE.roots.folderTree[0],
                        children: [{
                            ...FIXTURE_SERIALIZED_STATE.roots.folderTree[0]!.children[0]!,
                            children: [
                                {name: 'task-1.md', absolutePath: TASK_ONE, isInGraph: true},
                                {name: 'task-2.md', absolutePath: TASK_TWO, isInGraph: true},
                            ],
                        }],
                    }],
                },
            }),
            dispatchLiveCommand: vi.fn(),
        })

        const result = await liveView({port: 4321})

        expect(result.output).toContain('▢ tasks/ [collapsed ⊟ 2 descendants, 1 outgoing]')
        expect(result.output).toContain('· Root')
        expect(result.output).toContain(`${TASKS_FOLDER} -> ${ROOT_NODE}`)
        expect(result.virtualFolderCount).toBe(1)
        expect(result.fileNodeCount).toBe(1)
    })
})
