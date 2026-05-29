import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import {describe, expect, it} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {setGraph} from '@vt/graph-db-server/state/graph-store'
import {createGraph, type GraphNode} from '@vt/graph-model'
import {EXIT} from '../util/exitCodes'
import {runViewCommand} from './view.ts'
import {
    captureCommand,
    type CommandResult,
    parseStdoutJson,
    setStdoutIsTTY,
    setupViewTestContext,
    type ViewTestContext,
    waitFor,
} from './view-test-helpers.ts'

async function runViewJson(argv: string[]): Promise<unknown> {
    const result: CommandResult = await captureCommand(() => runViewCommand(argv))
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toBe('')
    return parseStdoutJson(result)
}

describe('runViewCommand (views, folders, selection, show)', () => {
    const ctx: ViewTestContext = setupViewTestContext()

    it('lists named project views with the active view marked', async () => {
        const {project} = ctx.harness()
        await runViewJson(['clone', 'main', 'scratch', '--project', project])

        const views = await runViewJson(['list', '--project', project])

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
        const {project} = ctx.harness()
        await runViewJson(['clone', 'main', 'scratch', '--project', project])

        await expect(runViewJson(['switch', 'scratch', '--project', project])).resolves.toMatchObject({
            name: 'scratch',
            isActive: true,
            is_active: true,
        })
    })

    it('clones a named view', async () => {
        const {project} = ctx.harness()
        await expect(
            runViewJson(['clone', 'main', 'scratch', '--project', project]),
        ).resolves.toMatchObject({
            name: 'scratch',
            isActive: false,
            is_active: false,
        })
    })

    it('rejects deletion of the active view with the daemon active-view error', async () => {
        const {project} = ctx.harness()
        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['delete', 'main', '--project', project]),
        )

        expect(result.exitCode).toBe(EXIT.DAEMON_HTTP_ERROR)
        expect(result.stderr).toMatch(/active view/i)
    })

    it('deletes a non-active view', async () => {
        const {project} = ctx.harness()
        await runViewJson(['clone', 'main', 'scratch', '--project', project])

        await expect(runViewJson(['delete', 'scratch', '--project', project])).resolves.toMatchObject({
            name: 'scratch',
            isActive: false,
            is_active: false,
        })
        await expect(ctx.createClient().views.list()).resolves.not.toEqual(
            expect.arrayContaining([expect.objectContaining({name: 'scratch'})]),
        )
    })

    it('sets folder state on the active view', async () => {
        const {project} = ctx.harness()
        const client: GraphDbClient = ctx.createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        const folderPath: string = join(project, 'docs')

        await expect(
            runViewJson([
                'set-folder',
                folderPath,
                'collapsed',
                '--project',
                project,
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
        const {project} = ctx.harness()
        const nodePath: string = join(project, 'one.md')
        await writeFile(nodePath, '# one\n\nbody text that should not be printed\n', 'utf8')
        await waitFor(async () => {
            const graph = await ctx.createClient().getGraph()
            return graph.nodes[nodePath] ? true : null
        })

        const body = await runViewJson(['show', '--project', project])
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
        const {project} = ctx.harness()
        const docsPath: string = join(project, 'docs')
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
        const client: GraphDbClient = ctx.createClient()
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
            runViewCommand(['show', '--project', project, '--session', sessionId]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(result.stdout).toContain('═══ STRUCTURE main (view applied) ═══')
        expect(result.stdout).toContain('▢ docs/ [collapsed:user 2 nodes')
        expect(result.stdout).not.toContain('"graph"')
    })

    it('sets selection for a pinned session', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        await expect(
            runViewJson([
                'selection',
                'set',
                'alpha',
                'beta',
                '--project',
                project,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['alpha', 'beta'],
        })
    })

    it('adds nodes to the existing selection', async () => {
        const {project} = ctx.harness()
        const client: GraphDbClient = ctx.createClient()
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
                '--project',
                project,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['alpha', 'beta', 'gamma'],
        })
    })

    it('removes nodes from the existing selection', async () => {
        const {project} = ctx.harness()
        const client: GraphDbClient = ctx.createClient()
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
                '--project',
                project,
                '--session',
                sessionId,
            ]),
        ).resolves.toEqual({
            selection: ['beta', 'gamma'],
        })
    })

    it('mints a fresh session for each show invocation when no session is provided', async () => {
        const {project} = ctx.harness()
        const client: GraphDbClient = ctx.createClient()

        expect((await client.health()).sessionCount).toBe(0)
        await expect(runViewJson(['show', '--project', project])).resolves.toMatchObject({
            activeView: {name: 'main'},
            selection: [],
        })
        expect((await client.health()).sessionCount).toBe(1)

        await expect(runViewJson(['show', '--project', project])).resolves.toMatchObject({
            activeView: {name: 'main'},
            selection: [],
        })
        expect((await client.health()).sessionCount).toBe(2)
    })

    it('shares state across view commands when a session is pinned', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        await runViewJson([
            'selection',
            'set',
            'shared-node',
            '--project',
            project,
            '--session',
            sessionId,
        ])

        await expect(
            runViewJson(['show', '--project', project, '--session', sessionId]),
        ).resolves.toMatchObject({
            selection: ['shared-node'],
        })
    })
})
