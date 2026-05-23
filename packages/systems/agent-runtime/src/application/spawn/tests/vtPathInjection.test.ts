/**
 * Black-box tests for the spawn-time vt-bin PATH injection.
 *
 * Two surfaces are covered:
 *
 *   - `prependVtBinToPath` — pure: takes an env-var map + a vt-bin
 *     directory, returns a new env-var map with the directory prepended
 *     to `PATH` using `node:path.delimiter`. Idempotent, null-safe.
 *
 *   - `buildTerminalEnvVars` end-to-end — the public path the spawn
 *     pipeline takes. We configure the runtime env to expose a vt-bin
 *     dir and assert the produced `PATH` starts with that dir. No
 *     internal mocks: the runtime env is configured normally.
 */

import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {configureAgentRuntime} from '../../runtime/runtime-config'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'
import {prependVtBinToPath} from '../vtPathInjection'

describe('prependVtBinToPath (pure)', () => {
    it('passes through unchanged when vtBinDir is null', () => {
        const input = {PATH: '/usr/bin:/bin', OTHER: 'value'}
        expect(prependVtBinToPath(input, null)).toEqual(input)
    })

    it('passes through unchanged when vtBinDir is empty string', () => {
        const input = {PATH: '/usr/bin:/bin'}
        expect(prependVtBinToPath(input, '')).toEqual(input)
    })

    it('sets PATH to vtBinDir when PATH is absent', () => {
        const result = prependVtBinToPath({OTHER: 'x'}, '/opt/vt/bin')
        expect(result.PATH).toBe('/opt/vt/bin')
        expect(result.OTHER).toBe('x')
    })

    it('sets PATH to vtBinDir when PATH is empty string', () => {
        const result = prependVtBinToPath({PATH: ''}, '/opt/vt/bin')
        expect(result.PATH).toBe('/opt/vt/bin')
    })

    it('prepends vtBinDir to a populated PATH using path.delimiter', () => {
        const existing: string = ['/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter)
        const result = prependVtBinToPath({PATH: existing}, '/opt/vt/bin')
        expect(result.PATH).toBe('/opt/vt/bin' + path.delimiter + existing)
    })

    it('is idempotent — repeat calls do not stack the entry', () => {
        const initial = prependVtBinToPath({PATH: '/usr/bin'}, '/opt/vt/bin')
        const repeated = prependVtBinToPath(initial, '/opt/vt/bin')
        expect(repeated.PATH).toBe(initial.PATH)
        expect(repeated).toEqual(initial)
    })

    it('is idempotent when PATH equals vtBinDir exactly (no trailing delimiter)', () => {
        const input = {PATH: '/opt/vt/bin'}
        expect(prependVtBinToPath(input, '/opt/vt/bin')).toEqual(input)
    })

    it('does not collapse a non-prefix match — distinct dirs sharing a prefix still prepend', () => {
        // `/opt/vt/bin-extra` starts with `/opt/vt/bin` as a substring but
        // is not the same path entry. We must still prepend.
        const result = prependVtBinToPath({PATH: '/opt/vt/bin-extra'}, '/opt/vt/bin')
        expect(result.PATH).toBe('/opt/vt/bin' + path.delimiter + '/opt/vt/bin-extra')
    })

    it('preserves unrelated env vars', () => {
        const result = prependVtBinToPath(
            {PATH: '/usr/bin', HOME: '/home/me', SHELL: '/bin/zsh'},
            '/opt/vt/bin',
        )
        expect(result.HOME).toBe('/home/me')
        expect(result.SHELL).toBe('/bin/zsh')
    })
})

describe('buildTerminalEnvVars — vt-bin PATH injection end-to-end', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-vtbin-spawn-'))
    })

    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
        configureAgentRuntime({})
    })

    it('prepends the configured vt-bin dir onto PATH', async () => {
        const vtBinDir: string = path.join(tempDir, 'vt-bin')
        await fs.mkdir(vtBinDir, {recursive: true})

        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWritePath: async (): Promise<string | null> => tempDir,
                getProjectRootWatchedDirectory: async (): Promise<string | null> => tempDir,
                getVtBinDir: (): string => vtBinDir,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {
                    AGENT_PROMPT: 'base prompt',
                    PATH: '/usr/bin:/bin',
                },
            } as never,
        })

        expect(envVars.PATH.startsWith(vtBinDir + path.delimiter)).toBe(true)
        expect(envVars.PATH).toContain('/usr/bin')
    })

    it('leaves PATH untouched when getVtBinDir is not registered', async () => {
        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWritePath: async (): Promise<string | null> => tempDir,
                getProjectRootWatchedDirectory: async (): Promise<string | null> => tempDir,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {
                    AGENT_PROMPT: 'base prompt',
                    PATH: '/usr/bin:/bin',
                },
            } as never,
        })

        expect(envVars.PATH).toBe('/usr/bin:/bin')
    })

    it('sets PATH from scratch when no PATH is injected and vt-bin is configured', async () => {
        const vtBinDir: string = path.join(tempDir, 'vt-bin')
        await fs.mkdir(vtBinDir, {recursive: true})

        configureAgentRuntime({
            env: {
                getAppSupportPath: (): string => tempDir,
                getVaultPaths: async (): Promise<readonly string[]> => [tempDir],
                getWritePath: async (): Promise<string | null> => tempDir,
                getProjectRootWatchedDirectory: async (): Promise<string | null> => tempDir,
                getVtBinDir: (): string => vtBinDir,
            },
        })

        const envVars: Record<string, string> = await buildTerminalEnvVars({
            contextNodePath: '/ctx',
            taskNodePath: '/task',
            terminalId: 'Aki',
            agentName: 'Aki',
            settings: {
                INJECT_ENV_VARS: {AGENT_PROMPT: 'base prompt'},
            } as never,
        })

        expect(envVars.PATH).toBe(vtBinDir)
    })
})
