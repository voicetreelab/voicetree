/**
 * BF-188 — integration test for vt-headless serve.
 *
 * Boots the headless MCP server in-process on port 0, connects
 * createLiveTransport, and verifies round-trips. Port 3002 is never bound.
 */
import {describe, it, expect} from 'vitest'
import {createHeadlessServer, type HeadlessServer} from '../src/headlessServer'
import {createLiveTransport} from '../src/liveTransport'

describe('vt-headless serve', () => {
    it('boots on ephemeral port — not 3002, not 0, responds to vt_get_live_state', async () => {
        const server: HeadlessServer = await createHeadlessServer()
        try {
            expect(server.port).not.toBe(3002)
            expect(server.port).not.toBe(0)
            expect(server.port).toBeGreaterThan(0)

            const transport = createLiveTransport(server.port)
            const state = await transport.getLiveState()

            expect(state.meta.schemaVersion).toBe(1)
            expect(state.meta.revision).toBe(0)
            expect(Object.keys(state.graph.nodes).length).toBe(0)
            expect(state.collapseSet.size).toBe(0)
        } finally {
            await server.close()
        }
    })

    it('dispatchLiveCommand(Collapse) returns Delta with collapseAdded + bumped revision', async () => {
        const server: HeadlessServer = await createHeadlessServer()
        try {
            const transport = createLiveTransport(server.port)
            const FOLDER = '/tmp/test-headless/tasks/'

            const delta = await transport.dispatchLiveCommand({type: 'Collapse', folder: FOLDER})

            expect(delta.revision).toBe(1)
            expect(delta.collapseAdded).toContain(FOLDER)
        } finally {
            await server.close()
        }
    })

    it('round-trip: Collapse → getLiveState reflects collapse and bumped revision', async () => {
        const server: HeadlessServer = await createHeadlessServer()
        try {
            const transport = createLiveTransport(server.port)
            const FOLDER = '/tmp/test-headless/tasks/'

            const stateBefore = await transport.getLiveState()
            expect(stateBefore.collapseSet.size).toBe(0)
            const revBefore = stateBefore.meta.revision

            await transport.dispatchLiveCommand({type: 'Collapse', folder: FOLDER})

            const stateAfter = await transport.getLiveState()
            expect(stateAfter.collapseSet.has(FOLDER)).toBe(true)
            expect(stateAfter.meta.revision).toBeGreaterThan(revBefore)
        } finally {
            await server.close()
        }
    })

    it('two concurrent servers bind distinct ports — no collision, neither is 3002', async () => {
        const [srv1, srv2] = await Promise.all([
            createHeadlessServer(),
            createHeadlessServer(),
        ])
        try {
            expect(srv1.port).not.toBe(srv2.port)
            expect(srv1.port).not.toBe(3002)
            expect(srv2.port).not.toBe(3002)

            // Both independently functional
            const [s1, s2] = await Promise.all([
                createLiveTransport(srv1.port).getLiveState(),
                createLiveTransport(srv2.port).getLiveState(),
            ])
            expect(s1.meta.revision).toBe(0)
            expect(s2.meta.revision).toBe(0)

            // Mutations are isolated
            await createLiveTransport(srv1.port).dispatchLiveCommand({
                type: 'Collapse',
                folder: '/tmp/test-headless/tasks/',
            })
            const s1After = await createLiveTransport(srv1.port).getLiveState()
            const s2After = await createLiveTransport(srv2.port).getLiveState()
            expect(s1After.collapseSet.size).toBe(1)
            expect(s2After.collapseSet.size).toBe(0)
        } finally {
            await Promise.all([srv1.close(), srv2.close()])
        }
    })
})
