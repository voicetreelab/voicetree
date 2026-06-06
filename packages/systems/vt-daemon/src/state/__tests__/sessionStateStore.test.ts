// BF-379 — black-box behaviour of the daemon's session state store against
// a real vt-graphd. No internal mocks: a tmpdir project is opened, a real
// graph-db-server is started, and the store talks to it over HTTP.
//
// What we assert is the observable shape of `getCurrentSessionState` and
// `applyCommandToSessionState` — exactly what JSON-RPC clients see at the
// /rpc wire. The store is the deep function; the HTTP boundary is the
// only surface we exercise.

import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {createEmptyGraph} from '@vt/graph-model'
import {saveProjectConfigForDirectory} from '@vt/app-config/project-config'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server/server'
import {project as projectSessionGraph, type Command, type State} from '@vt/graph-state'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

import {
    applyCommandToSessionState,
    getCurrentSessionState,
    __resetSessionStateForTests,
} from '../sessionStateStore.ts'

interface Harness {
    readonly project: string
    readonly voicetreeHomePath: string
    readonly root: string
    readonly fixtureNodeId: NodeIdAndFilePath
    readonly taskFolderId: string
    readonly taskFolderNoteId: NodeIdAndFilePath
    readonly handle: DaemonHandle
}

const FIXTURE_BASENAME: string = 'fixture.md'

async function startHarness(): Promise<Harness> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-session-store-')))
    const voicetreeHomePath: string = join(root, 'voicetree-home')
    const project: string = join(root, 'project')
    await mkdir(voicetreeHomePath, {recursive: true})
    await mkdir(project, {recursive: true})
    process.env.VOICETREE_HOME_PATH = voicetreeHomePath
    clearWatchFolderState()
    setGraph(createEmptyGraph())

    const fixturePath: string = join(project, FIXTURE_BASENAME)
    await writeFile(fixturePath, '# fixture\n', 'utf-8')
    const taskFolderPath: string = join(project, 'task_folder')
    await mkdir(taskFolderPath, {recursive: true})
    const taskFolderNotePath: string = join(taskFolderPath, 'task_folder.md')
    await writeFile(taskFolderNotePath, '# task folder\n', 'utf-8')
    await saveProjectConfigForDirectory(project, {writeFolderPath: '.'})

    const handle: DaemonHandle = await startDaemon({
        project,
        voicetreeHomePath,
        createStarterIfEmpty: false,
    })

    return {
        project,
        voicetreeHomePath,
        root,
        fixtureNodeId: fixturePath as NodeIdAndFilePath,
        taskFolderId: `${taskFolderPath}/`,
        taskFolderNoteId: taskFolderNotePath as NodeIdAndFilePath,
        handle,
    }
}

async function stopHarness(h: Harness): Promise<void> {
    __resetSessionStateForTests()
    await h.handle.stop().catch((): void => {})
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(h.root, {recursive: true, force: true})
}

// Polls vt-graphd until its in-memory graph reflects the on-disk fixture.
// `startDaemon` returns as soon as the HTTP server is up, but the chokidar
// watcher inside the daemon ingests files asynchronously — the fixture
// markdown may not yet be indexed when the test continues. Without this
// wait, the first `getCurrentSessionState` race-condition-loads an empty
// graph from vt-graphd, masking what the store actually mirrors at steady
// state.
async function waitForNodeIndexed(h: Harness, nodeId: NodeIdAndFilePath): Promise<void> {
    const deadline: number = Date.now() + 5000
    while (Date.now() < deadline) {
        __resetSessionStateForTests(h.project)
        const state: State = await getCurrentSessionState(h.project)
        if (Object.prototype.hasOwnProperty.call(state.graph.nodes, nodeId)) {
            return
        }
        await new Promise<void>((r) => setTimeout(r, 50))
    }
    throw new Error(`node ${nodeId} not indexed by vt-graphd within 5s`)
}

async function waitForFixtureIndexed(h: Harness): Promise<void> {
    await waitForNodeIndexed(h, h.fixtureNodeId)
}

describe('sessionStateStore', (): void => {
    let h: Harness

    beforeEach(async (): Promise<void> => {
        h = await startHarness()
    })

    afterEach(async (): Promise<void> => {
        await stopHarness(h)
    })

    it('bootstraps initial state from vt-graphd on first read', async (): Promise<void> => {
        await waitForFixtureIndexed(h)

        const state: State = await getCurrentSessionState(h.project)

        expect(state.meta.revision).toBe(0)
        expect(state.meta.schemaVersion).toBe(1)
        // writeFolderPath seeded into roots.loaded mirrors live-state-store's
        // bootstrapRootsFromProjectConfig.
        expect([...state.roots.loaded]).toEqual([h.project])
        expect(state.layout.positions.size).toBe(0)
        expect(state.selection.size).toBe(0)
    })

    it('bootstraps a graph-derived folder tree for folder task notes', async (): Promise<void> => {
        await waitForNodeIndexed(h, h.taskFolderNoteId)

        const state: State = await getCurrentSessionState(h.project)
        const projected: ProjectedGraph = projectSessionGraph(state)

        expect(state.roots.folderTree.length).toBeGreaterThan(0)
        expect(projected.nodes.some((node) => node.id === h.taskFolderId && node.kind === 'folder')).toBe(true)
        expect(projected.nodes.some((node) => node.id === h.taskFolderNoteId)).toBe(false)
    })

    it('bumps revision monotonically across two Move commands and surfaces the position in layout', async (): Promise<void> => {
        await waitForFixtureIndexed(h)

        const moveOne: Command = {
            type: 'Move',
            id: h.fixtureNodeId,
            to: {x: 10, y: 20},
        }
        const moveTwo: Command = {
            type: 'Move',
            id: h.fixtureNodeId,
            to: {x: 30, y: 40},
        }

        const first: {state: State; delta: {revision: number}} = await applyCommandToSessionState(h.project, moveOne)
        expect(first.delta.revision).toBe(1)
        expect(first.state.meta.revision).toBe(1)
        expect(first.state.layout.positions.get(h.fixtureNodeId)).toEqual({x: 10, y: 20})

        const second: {state: State; delta: {revision: number}} = await applyCommandToSessionState(h.project, moveTwo)
        expect(second.delta.revision).toBe(2)
        expect(second.state.meta.revision).toBe(2)
        expect(second.state.layout.positions.get(h.fixtureNodeId)).toEqual({x: 30, y: 40})

        // The next read reflects the mutation, not a re-bootstrap.
        const after: State = await getCurrentSessionState(h.project)
        expect(after.meta.revision).toBe(2)
        expect(after.layout.positions.get(h.fixtureNodeId)).toEqual({x: 30, y: 40})
    })

    it('__resetSessionStateForTests evicts the per-project entry so the next read re-bootstraps', async (): Promise<void> => {
        await waitForFixtureIndexed(h)

        const moved: {state: State} = await applyCommandToSessionState(h.project, {
            type: 'Move',
            id: h.fixtureNodeId,
            to: {x: 99, y: 99},
        })
        expect(moved.state.meta.revision).toBe(1)

        __resetSessionStateForTests(h.project)

        const rebootstrapped: State = await getCurrentSessionState(h.project)
        expect(rebootstrapped.meta.revision).toBe(0)
        expect(rebootstrapped.layout.positions.size).toBe(0)
    })

})
