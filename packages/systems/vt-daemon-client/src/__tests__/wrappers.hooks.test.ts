/**
 * Black-box integration test for the `hooks` wrapper facade (1 route:
 * dispatchOnNewNodeHooks). Real loopback HTTP server + real JSON-RPC
 * wire.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {GraphDelta} from '@vt/graph-model/graph'

import {bindVtDaemonClient} from '../wrappers/index.ts'
import {startFakeRpcServer, type FakeRpcServerHandle} from './fixtures/fakeRpcServer.ts'

describe('vt-daemon-client wrappers — hooks facade', (): void => {
    let server: FakeRpcServerHandle

    beforeEach(async (): Promise<void> => {
        server = await startFakeRpcServer({
            dispatchOnNewNodeHooks: () => null,
        })
    })

    afterEach(async (): Promise<void> => {
        await server.stop()
    })

    it('dispatchOnNewNodeHooks forwards {delta, hookCommand} as JSON-RPC params', async (): Promise<void> => {
        const vtd = bindVtDaemonClient(server.client)
        // Empty delta is sufficient — the wrapper is structural; the
        // daemon is what fans out the hooks. The wire only carries the
        // shape on its way through.
        const delta: GraphDelta = []
        await vtd.hooks.dispatchOnNewNodeHooks({delta, hookCommand: 'my-hook'})
        expect(server.received).toHaveLength(1)
        expect(server.received[0].method).toBe('dispatchOnNewNodeHooks')
        expect(server.received[0].params).toEqual({delta: [], hookCommand: 'my-hook'})
    })
})
