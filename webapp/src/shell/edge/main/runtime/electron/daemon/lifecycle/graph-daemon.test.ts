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
    setActiveProjectAndEnsureDaemon,
    shutdownActiveDaemonConnection,
} from './graph-daemon'

describe('setActiveProjectAndEnsureDaemon', () => {
    const projects: string[] = []

    afterEach(async () => {
        await shutdownActiveDaemonConnection().catch(() => undefined)
        clearDaemonClientCache()
        await Promise.all(
            projects.splice(0).map((project) =>
                rm(project, { recursive: true, force: true }).catch(() => undefined),
            ),
        )
    })

    test('ensures a project-bound daemon and reuses it for repeated calls', async () => {
        const project: string = await mkdtemp(path.join(tmpdir(), 'graph-daemon-test-'))
        projects.push(project)

        const first = await setActiveProjectAndEnsureDaemon(project)
        const firstHealth = await first.client.health()
        expect(firstHealth.project).toBe(project)
        expect(getActiveDaemonClient()).toBe(first.client)
        expect(first.port).toBeGreaterThan(0)
        expect(typeof first.pid).toBe('number')

        const second = await setActiveProjectAndEnsureDaemon(project)
        expect(second.port).toBe(first.port)
        expect(second.pid).toBe(first.pid)
        expect(second.client).toBe(first.client)
    }, 30_000)
})
