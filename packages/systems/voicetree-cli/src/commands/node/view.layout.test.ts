import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {GraphDbClient} from '@vt/graph-db-client'
import {main} from '../../voicetree-cli'
import {EXIT} from '../util/exitCodes'
import {runViewCommand} from './view.ts'
import {
    captureCommand,
    type CommandResult,
    setupViewTestContext,
    type ViewTestContext,
} from './view-test-helpers.ts'

describe('runViewCommand layout (set-pan / set-zoom / set-positions)', () => {
    const ctx: ViewTestContext = setupViewTestContext()

    it('sets pan for a pinned session', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-pan',
                '10',
                '20',
                '--project',
                project,
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
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()
        process.env.VT_SESSION = sessionId

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '1.5', '--project', project]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
        await expect(ctx.createClient().getSessionState(sessionId)).resolves.toMatchObject({
            layout: {
                zoom: 1.5,
            },
        })
    })

    it('rejects a zero zoom with an argument-validation error and applies no mutation', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '0', '--project', project, '--session', sessionId]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/zoom must be a positive number/)
        // The rejected command must not have mutated the session: zoom stays 1.
        await expect(ctx.createClient().getSessionState(sessionId)).resolves.toMatchObject({
            layout: {zoom: 1},
        })
    })

    it('rejects a negative zoom with an argument-validation error', async () => {
        const {project} = ctx.harness()
        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '-1', '--project', project]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/zoom must be a positive number/)
    })

    it('rejects an absurdly large zoom beyond the renderer clamp range', async () => {
        const {project} = ctx.harness()
        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-zoom', '1e60', '--project', project]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toMatch(/zoom must be a positive number/)
    })

    it('accepts a small positive zoom inside the valid range', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            runViewCommand([
                'layout',
                'set-zoom',
                '0.25',
                '--project',
                project,
                '--session',
                sessionId,
            ]),
        )

        expect(result.exitCode).toBeNull()
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toMatchObject({layout: {zoom: 0.25}})
        await expect(ctx.createClient().getSessionState(sessionId)).resolves.toMatchObject({
            layout: {zoom: 0.25},
        })
    })

    it('loads positions from a JSON file and preserves existing pan', async () => {
        const {project, root} = ctx.harness()
        const client: GraphDbClient = ctx.createClient()
        const {sessionId}: {sessionId: string} = await client.createSession()
        const filePath: string = join(root, 'positions.json')

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
                '--project',
                project,
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
        const {project, root} = ctx.harness()
        const filePath: string = join(root, 'invalid-positions.json')
        await writeFile(filePath, '{not valid json', 'utf8')

        const result: CommandResult = await captureCommand(() =>
            runViewCommand(['layout', 'set-positions', filePath, '--project', project]),
        )

        expect(result.exitCode).toBe(EXIT.ARG_VALIDATION)
        expect(result.stderr).toContain('error: Could not parse positions JSON')
    })

    it('dispatches view commands through the top-level CLI entrypoint', async () => {
        const {project} = ctx.harness()
        const {sessionId}: {sessionId: string} = await ctx.createClient().createSession()

        const result: CommandResult = await captureCommand(() =>
            main([
                'view',
                'layout',
                'set-pan',
                '4',
                '9',
                '--project',
                project,
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
})
