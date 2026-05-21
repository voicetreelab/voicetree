import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now()),
    },
}))

import {
    clearDaemonClientCache,
    ensureDaemonProcess,
    getActiveDaemonClient,
    shutdownActiveDaemonConnection,
} from './graph-daemon'

describe('ensureDaemonProcess', () => {
    afterEach(async () => {
        await shutdownActiveDaemonConnection().catch(() => undefined)
        clearDaemonClientCache()
    })

    test('starts a vault-less daemon once and reuses it', async () => {
        const first = await ensureDaemonProcess()
        const firstHealth = await first.client.health()
        expect(firstHealth.vault).toBe('')
        expect(getActiveDaemonClient()).toBe(first.client)

        const second = await ensureDaemonProcess()
        expect(second.port).toBe(first.port)
        expect(second.client).toBe(first.client)
    }, 30_000)
})
