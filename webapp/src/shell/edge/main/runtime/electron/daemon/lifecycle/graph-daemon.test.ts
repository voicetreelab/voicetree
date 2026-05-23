import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now()),
    },
}))

import {
    clearDaemonClientCache,
    getActiveDaemonClient,
    setActiveVaultAndEnsureDaemon,
    shutdownActiveDaemonConnection,
} from './graph-daemon'

describe('setActiveVaultAndEnsureDaemon', () => {
    const vaults: string[] = []

    afterEach(async () => {
        await shutdownActiveDaemonConnection().catch(() => undefined)
        clearDaemonClientCache()
        await Promise.all(
            vaults.splice(0).map((vault) =>
                rm(vault, { recursive: true, force: true }).catch(() => undefined),
            ),
        )
    })

    test('ensures a vault-bound daemon and reuses it for repeated calls', async () => {
        const vault: string = await mkdtemp(path.join(tmpdir(), 'graph-daemon-test-'))
        vaults.push(vault)

        const first = await setActiveVaultAndEnsureDaemon(vault)
        const firstHealth = await first.client.health()
        expect(firstHealth.vault).toBe(vault)
        expect(getActiveDaemonClient()).toBe(first.client)
        expect(first.port).toBeGreaterThan(0)
        expect(typeof first.pid).toBe('number')

        const second = await setActiveVaultAndEnsureDaemon(vault)
        expect(second.port).toBe(first.port)
        expect(second.pid).toBe(first.pid)
        expect(second.client).toBe(first.client)
    }, 30_000)
})
