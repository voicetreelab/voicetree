import {mkdir, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {clearWatchFolderState} from '@vt/graph-db-server/state/watch-folder-store'
import {type DaemonHandle, startDaemon} from '@vt/graph-db-server/server'
import {
    createGraph,
    createEmptyGraph,
    type GraphNode,
} from '@vt/graph-model'
import {main} from '../../voicetree-cli'
import {EXIT} from '../util/exitCodes'
import {runViewCommand} from './view.ts'
import {
    captureCommand,
    type CommandResult,
    createHarness,
    type Harness,
    parseStdoutJson,
    setStdoutIsTTY,
    waitFor,
} from './view-test-helpers.ts'

async function runViewJson(argv: string[]): Promise<unknown> {
    const result: CommandResult = await captureCommand(() => runViewCommand(argv))
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toBe('')
    return parseStdoutJson(result)
}

describe('runViewCommand', () => {
    let daemonHandle: DaemonHandle
    let harness: Harness
    let originalVoicetreeHomePath: string | undefined
    let originalSessionEnv: string | undefined
    let originalCwd: string
    let stdoutIsTTYDescriptor: PropertyDescriptor | undefined

    function createClient(): GraphDbClient {
        return new GraphDbClient({
            baseUrl: `http://127.0.0.1:${daemonHandle.port}`,
        })
    }

    beforeEach(async () => {
        harness = await createHarness()
        originalVoicetreeHomePath = process.env.VOICETREE_HOME_PATH
        originalSessionEnv = process.env.VT_SESSION
        process.env.VOICETREE_HOME_PATH = harness.voicetreeHomePath
        delete process.env.VT_SESSION
        originalCwd = process.cwd()
        stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
        setStdoutIsTTY(false)
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        daemonHandle = await startDaemon({vault: harness.vault, createStarterIfEmpty: false})
    })

    afterEach(async () => {
        process.chdir(originalCwd)

        if (stdoutIsTTYDescriptor) {
            Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor)
        } else {
            setStdoutIsTTY(true)
        }

        await daemonHandle.stop().catch(() => {})
        clearWatchFolderState()
        setGraph(createEmptyGraph())

        if (originalVoicetreeHomePath === undefined) {
            delete process.env.VOICETREE_HOME_PATH
        } else {
            process.env.VOICETREE_HOME_PATH = originalVoicetreeHomePath
        }

        if (originalSessionEnv === undefined) {
            delete process.env.VT_SESSION
        } else {
            process.env.VT_SESSION = originalSessionEnv
        }

        await rm(harness.root, {recursive: true, force: true})
        vi.restoreAllMocks()
    })

    it('sets pan for a pinned session', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-pan',
                '10',
                '20',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                pan: {x: 10, y: 20},
                zoom: 1,
            },
        })
    })

    it('uses VT_SESSION when set-zoom is run without an explicit session flag', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()
        process.env.VT_SESSION = sessionId

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '1.5', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
        await expect(createClient().getSessionState(sessionId)).resolves.toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
    })

    it('loads positions from a JSON file and preserves existing pan', async () => {
        const client: GraphDbClient = createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        const filePath: string = join(harness.root, 'positions.json')

        await client.updateLayout(sessionId, {
            pan: {x: 7, y: 8},
        })
        await writeFile(
            filePath,
            JSON.stringify({
                alpha: {x: 1, y: 2},
                beta: {x: 3, y: 4},
            }),
            'utf8',
        )

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-positions',
                filePath,
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({
            layout: {
                positions: {
                    alpha: {x: 1, y: 2},
                    beta: {x: 3, y: 4},
                },
                pan: {x: 7, y: 8},
                zoom: 1,
            },
        })
    })

    it('exits with an argument-validation code when the positions file is invalid JSON', async () => {
        const filePath: string = join(harness.root, 'invalid-positions.json')
        await writeFile(filePath, '{not valid json', 'utf8')

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-positions', filePath, '--vault', harness.vault]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toContain('error: Could not parse positions JSON')
    })

    it('dispatches view commands through the top-level CLI entrypoint', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            main([
                'view',
                'layout',
                'set-pan',
                '4',
                '9',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                pan: {x: 4, y: 9},
            },
        })
    })

    it('lists named vault views with the active view marked', async () => {
        await runViewJson(['clone', 'main', 'scratch', '--vault', harness.vault])

        const views = await runViewJson(['list', '--vault', harness.vault])

        expect(views).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'main',
                    isActive: true,
                    is_active: true,
                }),
                expect.objectContaining({
                    name: 'scratch',
                    isActive: false,
                    is_active: false,
                }),
            ]),
        )
    })

    it('switches views by name', async () => {
        await runViewJson(['clone', 'main', 'scratch', '--vault', harness.vault])

        await expect(runViewJson(['switch', 'scratch', '--vault', harness.vault])).resolves.toMatchObject({
            name: 'scratch',
            isActive: true,
            is_active: true,
        })
    })

    it('clones a named view', async () => {
        await expect(
            runViewJson(['clone', 'main', 'scratch', '--vault', harness.vault]),
        ).resolves.toMatchObject({
            name: 'scratch',
            isActive: false,
            is_active: false,
        })
    })

    it('rejects deletion of the active view with the daemon active-view error', async () => {
        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['delete', 'main', '--vault', harness.vault]),
        )

        expect(result.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(result.stderr).toMatch(/active view/i)
    })

    it('deletes a non-active view', async () => {
        await runViewJson(['clone', 'main', 'scratch', '--vault', harness.vault])

        await expect(runViewJson(['delete', 'scratch', '--vault', harness.vault])).resolves.toMatchObject({
            name: 'scratch',
            isActive: false,
            is_active: false,
        })
        await expect(createClient().views.list()).resolves.not.toEqual(
            expect.arrayContaining([expect.objectContaining({name: 'scratch'})]),
        )
    })

    it('sets folder state on the active view', async () => {
        const client: GraphDbClient = createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        const folderPath: string = join(harness.vault, 'docs')

        await expect(
            runViewJson([
                'set-folder',
                folderPath,
                'collapsed',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            path: folderPath,
            state: 'collapsed',
        })
        const state = await client.getFolderState(sessionId)
        expect(state).toMatchObject({
            activeView: {name: 'main'},
        })
        expect(state.folderState).toContainEqual([folderPath, 'collapsed'])
    })

    it('omits node markdown content from show JSON output', async () => {
        const nodePath: string = join(harness.vault, 'one.md')
        await writeFile(nodePath, '# one\n\nbody text that should not be printed\n', 'utf8')
        await waitFor(async () => {
            const graph = await createClient().getGraph()
            return graph.nodes[nodePath] ? true : null
        })

        const body = await runViewJson(['show', '--vault', harness.vault])
        expect(body).toMatchObject({
            graph: {
                nodes: {
                    [nodePath]: expect.any(Object),
                },
            },
        })

        const nodes = (body as {graph: {nodes: Record<string, unknown>}}).graph.nodes
        expect(nodes[nodePath]).not.toHaveProperty('contentWithoutYamlOrLinks')
    })

    it('renders the projected graph for human show output', async () => {
        const docsPath: string = join(harness.vault, 'docs')
        const alphaPath: string = join(docsPath, 'alpha.md')
        const betaPath: string = join(docsPath, 'beta.md')
        const makeNode = (absoluteFilePathIsID: string, title: string): GraphNode => ({
            kind: 'leaf',
            outgoingEdges: [],
            absoluteFilePathIsID,
            contentWithoutYamlOrLinks: title,
            nodeUIMetadata: {
                color: O.none,
                position: O.none,
                additionalYAMLProps: {},
            },
        })
        setGraph(createGraph({
            [alphaPath]: makeNode(alphaPath, 'Alpha'),
            [betaPath]: makeNode(betaPath, 'Beta'),
        }))
        const client: GraphDbClient = createClient()
        await mkdir(docsPath, {recursive: true})
        await writeFile(alphaPath, '# Alpha\n', 'utf8')
        await writeFile(betaPath, '# Beta\n', 'utf8')
        await waitFor(async () => {
            const graph = await client.getGraph()
            return graph.nodes[alphaPath] && graph.nodes[betaPath] ? true : null
        })
        const {sessionId}: {sessionId: string} = await client.createSession()
        await client.setFolderState(sessionId, docsPath, 'collapsed')

        setStdoutIsTTY(true)
        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['show', '--vault', harness.vault, '--session', sessionId]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain('═══ STRUCTURE main (view applied) ═══')
        expect(result.stdout).toContain('▢ docs/ [collapsed:user 2 nodes')
        expect(result.stdout).not.toContain('"graph"')
    })

    it('sets selection for a pinned session', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        await expect(
            runViewJson([
                'selection',
                'set',
                'alpha',
                'beta',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['alpha', 'beta'],
        })
    })

    it('adds nodes to the existing selection', async () => {
        const client: GraphDbClient = createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        await client.setSelection(sessionId, {
            nodeIds: ['alpha', 'beta'],
            mode: 'replace',
        })

        await expect(
            runViewJson([
                'selection',
                'add',
                'gamma',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['alpha', 'beta', 'gamma'],
        })
    })

    it('removes nodes from the existing selection', async () => {
        const client: GraphDbClient = createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        await client.setSelection(sessionId, {
            nodeIds: ['alpha', 'beta', 'gamma'],
            mode: 'replace',
        })

        await expect(
            runViewJson([
                'selection',
                'remove',
                'alpha',
                '--vault',
                harness.vault,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['beta', 'gamma'],
        })
    })

    it('mints a fresh session for each show invocation when no session is provided', async () => {
        const client: GraphDbClient = createClient()

        expect((await client.health()).sessionCount).toBe(0)
        await expect(runViewJson(['show', '--vault', harness.vault])).resolves.toMatchObject({
            activeView: {name: 'main'},
            selection: [],
        })
        expect((await client.health()).sessionCount).toBe(1)

        await expect(runViewJson(['show', '--vault', harness.vault])).resolves.toMatchObject({
            activeView: {name: 'main'},
            selection: [],
        })
        expect((await client.health()).sessionCount).toBe(2)
    })

    it('shares state across view commands when a session is pinned', async () => {
        const {sessionId}: {sessionId: string} = await createClient().createSession()

        await runViewJson([
            'selection',
            'set',
            'shared-node',
            '--vault',
            harness.vault,
            '--session',
            sessionId,
        ])

        await expect(
            runViewJson(['show', '--vault', harness.vault, '--session', sessionId]),
        ).resolves.toMatchObject({
            selection: ['shared-node'],
        })
    })
})
