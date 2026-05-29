import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {
    detectVaultFromCwd,
    discoverDaemonEndpoint,
    discoverDaemonEndpointForVault,
} from '../src/pathDiscovery.ts'

async function makeVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'vt-rpc-disco-'))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

describe('detectVaultFromCwd', (): void => {
    it('finds the vault when started directly in the vault root', async (): Promise<void> => {
        const vault: string = await makeVault()
        expect(detectVaultFromCwd(vault)).toBe(vault)
    })

    it('climbs from a nested subdirectory to find the vault root', async (): Promise<void> => {
        const vault: string = await makeVault()
        const nested: string = join(vault, 'a', 'b', 'c')
        await mkdir(nested, {recursive: true})
        expect(detectVaultFromCwd(nested)).toBe(vault)
    })

    it('returns null when no vault ancestor exists', async (): Promise<void> => {
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-no-vault-'))
        expect(detectVaultFromCwd(isolated)).toBe(null)
    })
})

describe('discoverDaemonEndpoint chain', (): void => {
    it('honors $VOICETREE_DAEMON_URL above all', async (): Promise<void> => {
        const vault: string = await makeVault()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), '12345\n', 'utf8')

        const endpoint = await discoverDaemonEndpoint({
            cwd: vault,
            env: {VOICETREE_DAEMON_URL: 'http://192.168.1.50:51337', VOICETREE_PROJECT_PATH: vault},
        })
        expect(endpoint?.url).toBe('http://192.168.1.50:51337')
        expect(endpoint?.source).toBe('env_url')
        expect(endpoint?.vaultPath).toBe(vault)
    })

    it('falls back to cwd up-walk + rpc.port file', async (): Promise<void> => {
        const vault: string = await makeVault()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), '51111\n', 'utf8')

        const endpoint = await discoverDaemonEndpoint({cwd: vault, env: {}})
        expect(endpoint?.url).toBe('http://127.0.0.1:51111')
        expect(endpoint?.source).toBe('cwd_up_walk')
        expect(endpoint?.vaultPath).toBe(vault)
    })

    it('falls back to $VOICETREE_PROJECT_PATH when cwd has no vault ancestor', async (): Promise<void> => {
        const vault: string = await makeVault()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), '40404\n', 'utf8')
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-iso-'))

        const endpoint = await discoverDaemonEndpoint({
            cwd: isolated,
            env: {VOICETREE_PROJECT_PATH: vault},
        })
        expect(endpoint?.url).toBe('http://127.0.0.1:40404')
        expect(endpoint?.source).toBe('env_vault_path')
    })

    it('returns null when nothing resolves', async (): Promise<void> => {
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-nothing-'))
        const endpoint = await discoverDaemonEndpoint({cwd: isolated, env: {}})
        expect(endpoint).toBe(null)
    })
})

describe('discoverDaemonEndpointForVault', (): void => {
    it('reads rpc.port from the explicit vault, ignoring cwd', async (): Promise<void> => {
        const vault: string = await makeVault()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), '60606\n', 'utf8')
        const isolated: string = await mkdtemp(join(tmpdir(), 'vt-rpc-explicit-iso-'))

        const endpoint = await discoverDaemonEndpointForVault(vault, {
            env: {},
        })
        expect(endpoint?.url).toBe('http://127.0.0.1:60606')
        expect(endpoint?.vaultPath).toBe(vault)
        expect(endpoint?.source).toBe('env_vault_path')

        // Sanity: the discovery doesn't depend on cwd at all (we passed env={},
        // so cwd up-walk wouldn't have helped anyway, but the implementation
        // doesn't even consult `process.cwd()` for explicit-vault discovery).
        expect(isolated).not.toBe(vault)
    })

    it('honors $VOICETREE_DAEMON_URL over the vault rpc.port', async (): Promise<void> => {
        const vault: string = await makeVault()
        await writeFile(join(vault, '.voicetree', 'rpc.port'), '60606\n', 'utf8')

        const endpoint = await discoverDaemonEndpointForVault(vault, {
            env: {VOICETREE_DAEMON_URL: 'http://192.168.1.50:51337'},
        })
        expect(endpoint?.url).toBe('http://192.168.1.50:51337')
        expect(endpoint?.source).toBe('env_url')
        // Token vault is always the explicit vault, never $VOICETREE_PROJECT_PATH.
        expect(endpoint?.vaultPath).toBe(vault)
    })

    it('returns null when rpc.port is missing and no env URL', async (): Promise<void> => {
        const vault: string = await makeVault()
        // No rpc.port file written.
        const endpoint = await discoverDaemonEndpointForVault(vault, {env: {}})
        expect(endpoint).toBe(null)
    })

    it('returns null for an empty vault path', async (): Promise<void> => {
        const endpoint = await discoverDaemonEndpointForVault('', {env: {}})
        expect(endpoint).toBe(null)
    })
})
