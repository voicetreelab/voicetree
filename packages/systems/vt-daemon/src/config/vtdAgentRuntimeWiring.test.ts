import {describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {FilePath} from '@vt/graph-model/graph'
import {configureAgentRuntimeForVtd} from './vtdAgentRuntimeWiring.ts'
import {getRuntimeEnv, type GraphStateBridge} from '../agent-runtime/runtime/runtime-config.ts'

// Black-box contract test for `configureAgentRuntimeForVtd`.
//
// Regression guard: vtd used to register an `env` provider carrying ONLY
// `getVtBinDir`, leaving `getProjectRoot`/`getWriteFolderPath` undefined. Every
// project-root-dependent feature that reads `getRuntimeEnv().getProjectRoot`
// (recovery discovery, the tmux namespace resolver, terminal-manager,
// removePersistedAgentRecord) then resolved null — so the resume / Surviving
// Agents UI was dark for every vtd project. We assert the env provider now
// surfaces project resolution by delegating to the injected graph bridge.
//
// The graph bridge is an injected boundary dependency, not an internal: we
// feed a fake one in and assert on the observable env-provider output.

function fakeGraphBridge(overrides: Partial<GraphStateBridge>): GraphStateBridge {
    const notImplemented = (name: string) => (): never => {
        throw new Error(`fakeGraphBridge.${name} not implemented`)
    }
    return {
        getGraph: notImplemented('getGraph'),
        getProjectPaths: notImplemented('getProjectPaths'),
        getWriteFolderPath: notImplemented('getWriteFolderPath'),
        getProjectRoot: notImplemented('getProjectRoot'),
        getWatchStatus: notImplemented('getWatchStatus'),
        applyGraphDelta: notImplemented('applyGraphDelta'),
        createContextNode: notImplemented('createContextNode'),
        createContextNodeFromSelectedNodes: notImplemented('createContextNodeFromSelectedNodes'),
        getUnseenNodesAroundContextNode: notImplemented('getUnseenNodesAroundContextNode'),
        updateContextNodeContainedIds: notImplemented('updateContextNodeContainedIds'),
        ...overrides,
    }
}

describe('configureAgentRuntimeForVtd — env project resolution', () => {
    const projectRoot = '/Users/test/voicetree/proj' as FilePath
    const writeFolder = '/Users/test/voicetree/proj/voicetree-x' as FilePath

    function configure(): void {
        configureAgentRuntimeForVtd(
            '/Users/test/voicetree/packages/systems/voicetree-cli',
            () => undefined,
            fakeGraphBridge({
                getProjectRoot: async (): Promise<FilePath | null> => projectRoot,
                getWriteFolderPath: async (): Promise<O.Option<FilePath>> => O.some(writeFolder),
            }),
        )
    }

    it('exposes getProjectRoot from the graph bridge (was undefined → recovery dark)', async () => {
        configure()
        const env = getRuntimeEnv()
        await expect(env.getProjectRoot?.()).resolves.toBe(projectRoot)
    })

    it('exposes getWriteFolderPath as a nullable (Option unwrapped) for the namespace fallback', async () => {
        configure()
        const env = getRuntimeEnv()
        await expect(env.getWriteFolderPath?.()).resolves.toBe(writeFolder)
    })

    it('maps a None write-folder to null rather than leaking the Option', async () => {
        configureAgentRuntimeForVtd(
            '/Users/test/voicetree/packages/systems/voicetree-cli',
            () => undefined,
            fakeGraphBridge({
                getProjectRoot: async (): Promise<FilePath | null> => projectRoot,
                getWriteFolderPath: async (): Promise<O.Option<FilePath>> => O.none,
            }),
        )
        const env = getRuntimeEnv()
        await expect(env.getWriteFolderPath?.()).resolves.toBeNull()
    })
})
