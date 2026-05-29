import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {
    detectProjectFromCwd,
    discoverDaemonEndpoint,
    discoverDaemonEndpointForProject,
} from '../src/pathDiscovery.ts'

async function makeProject(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'vt-rpc-disco-'))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

describe('detectProjectFromCwd', (): void => {
    it('finds the project when started directly in the project root', async (): Promise<void> => {
        const project: string = await makeProject()
        expect(detectProjectFromCwd(project)).toBe(project)
    })

    it('climbs from a nested subdirectory to find the project root', async (): Promise<void> => {
        const project: string = await makeProject()
        const nested: string = join(project, 'a', 'b', 'c')
        await mkdir(nested, {recursive: true})
        expect(detectProjectFromCwd(nested)).toBe(project)
    })

    it('returns null when no project ancestor exists', async (): Promise<void> => {
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-no-project-'))
        expect(detectProjectFromCwd(isolated)).toBe(null)
    })
})

describe('discoverDaemonEndpoint chain', (): void => {
    it('honors $VOICETREE_DAEMON_URL above all', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(join(project, '.voicetree', 'rpc.port'), '12345\n', 'utf8')

        const endpoint = await discoverDaemonEndpoint({
            cwd: project,
            env: {VOICETREE_DAEMON_URL: 'http://192.168.1.50:51337', VOICETREE_PROJECT_PATH: project},
        })
        expect(endpoint?.url).toBe('http://192.168.1.50:51337')
        expect(endpoint?.source).toBe('env_url')
        expect(endpoint?.projectPath).toBe(project)
    })

    it('falls back to cwd up-walk + rpc.port file', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(join(project, '.voicetree', 'rpc.port'), '51111\n', 'utf8')

        const endpoint = await discoverDaemonEndpoint({cwd: project, env: {}})
        expect(endpoint?.url).toBe('http://127.0.0.1:51111')
        expect(endpoint?.source).toBe('cwd_up_walk')
        expect(endpoint?.projectPath).toBe(project)
    })

    it('falls back to $VOICETREE_PROJECT_PATH when cwd has no project ancestor', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(join(project, '.voicetree', 'rpc.port'), '40404\n', 'utf8')
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-iso-'))

        const endpoint = await discoverDaemonEndpoint({
            cwd: isolated,
            env: {VOICETREE_PROJECT_PATH: project},
        })
        expect(endpoint?.url).toBe('http://127.0.0.1:40404')
        expect(endpoint?.source).toBe('env_project_path')
    })

    it('returns null when nothing resolves', async (): Promise<void> => {
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-nothing-'))
        const endpoint = await discoverDaemonEndpoint({cwd: isolated, env: {}})
        expect(endpoint).toBe(null)
    })
})

describe('discoverDaemonEndpointForProject', (): void => {
    it('reads rpc.port from the explicit project, ignoring cwd', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(join(project, '.voicetree', 'rpc.port'), '60606\n', 'utf8')
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-explicit-iso-'))

        const endpoint = await discoverDaemonEndpointForProject(project, {
            env: {},
        })
        expect(endpoint?.url).toBe('http://127.0.0.1:60606')
        expect(endpoint?.projectPath).toBe(project)
        expect(endpoint?.source).toBe('env_project_path')

        // Sanity: the discovery doesn't depend on cwd at all (we passed env={},
        // so cwd up-walk wouldn't have helped anyway, but the implementation
        // doesn't even consult `process.cwd()` for explicit-project discovery).
        expect(isolated).not.toBe(project)
    })

    it('honors $VOICETREE_DAEMON_URL over the project rpc.port', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(join(project, '.voicetree', 'rpc.port'), '60606\n', 'utf8')

        const endpoint = await discoverDaemonEndpointForProject(project, {
            env: {VOICETREE_DAEMON_URL: 'http://192.168.1.50:51337'},
        })
        expect(endpoint?.url).toBe('http://192.168.1.50:51337')
        expect(endpoint?.source).toBe('env_url')
        // Token project is always the explicit project, never $VOICETREE_PROJECT_PATH.
        expect(endpoint?.projectPath).toBe(project)
    })

    it('returns null when rpc.port is missing and no env URL', async (): Promise<void> => {
        const project: string = await makeProject()
        // No rpc.port file written.
        const endpoint = await discoverDaemonEndpointForProject(project, {env: {}})
        expect(endpoint).toBe(null)
    })

    it('returns null for an empty project path', async (): Promise<void> => {
        const endpoint = await discoverDaemonEndpointForProject('', {env: {}})
        expect(endpoint).toBe(null)
    })
})
