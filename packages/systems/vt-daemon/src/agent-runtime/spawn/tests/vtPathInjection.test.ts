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
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {buildTerminalEnvVars} from '../buildTerminalEnvVars'
import {
    defaultExecutablePath,
    inheritExecutablePathIfMissing,
    prependVtBinToPath,
    prependHomeBinToPath,
    resolveVtBinDir,
} from '../injection/vtPathInjection'

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

describe('resolveVtBinDir (pure)', () => {
    const ALWAYS_EXISTS: (p: string) => boolean = (): boolean => true
    const NEVER_EXISTS: (p: string) => boolean = (): boolean => false

    it('returns null when the package dir is null', () => {
        expect(resolveVtBinDir(null, ALWAYS_EXISTS)).toBeNull()
    })

    it('returns null when the package dir is empty', () => {
        expect(resolveVtBinDir('', ALWAYS_EXISTS)).toBeNull()
    })

    it('returns null when the package dir is relative (defensive)', () => {
        expect(resolveVtBinDir('packages/systems/voicetree-cli', ALWAYS_EXISTS)).toBeNull()
    })

    it('returns null when the vt script does not exist under bin/', () => {
        expect(resolveVtBinDir('/opt/voicetree-cli', NEVER_EXISTS)).toBeNull()
    })

    it('returns <packageDir>/bin when the vt script exists', () => {
        const packageDir: string = '/opt/voicetree-cli'
        const expectedBin: string = path.join(packageDir, 'bin')
        const expectedScript: string = path.join(expectedBin, 'vt')
        const seen: string[] = []
        const fileExists = (p: string): boolean => {
            seen.push(p)
            return p === expectedScript
        }
        expect(resolveVtBinDir(packageDir, fileExists)).toBe(expectedBin)
        expect(seen).toContain(expectedScript)
    })

    it('returns null on any directory that is not a valid CLI package root', () => {
        // The verifier is a pure existence check — it does not silently
        // accept a wrong-but-absolute path that lacks the bin/vt script.
        expect(resolveVtBinDir('/tmp/not-voicetree', NEVER_EXISTS)).toBeNull()
    })
})

describe('inheritExecutablePathIfMissing (pure)', () => {
    it('keeps an explicit PATH unchanged', () => {
        expect(inheritExecutablePathIfMissing({PATH: '/custom/bin'}, '/usr/bin', 'darwin').PATH)
            .toBe('/custom/bin')
    })

    it('inherits process PATH and appends the macOS baseline when PATH is absent', () => {
        const result = inheritExecutablePathIfMissing({OTHER: 'x'}, '/custom/bin:/usr/bin', 'darwin')
        expect(result.PATH).toContain('/custom/bin')
        expect(result.PATH).toContain('/opt/homebrew/bin')
        expect(result.PATH).toContain('/usr/local/bin')
        expect(result.PATH).toContain('/bin')
        expect(result.OTHER).toBe('x')
    })

    it('provides a Unix baseline even when inherited PATH is missing', () => {
        const result = inheritExecutablePathIfMissing({}, undefined, 'linux')
        expect(result.PATH).toBe(defaultExecutablePath('linux'))
        expect(result.PATH).toContain('/usr/bin')
        expect(result.PATH).toContain('/bin')
    })
})

describe('buildTerminalEnvVars — vt-bin PATH injection end-to-end', () => {
    let tempDir: string
    let originalPath: string | undefined

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-vtbin-spawn-'))
        process.env.VOICETREE_HOME_PATH = tempDir
        originalPath = process.env.PATH
    })

    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
        configureAgentRuntime({})
        delete process.env.VOICETREE_HOME_PATH
        if (originalPath === undefined) delete process.env.PATH
        else process.env.PATH = originalPath
    })

    it('prepends the configured vt-bin dir onto PATH', async () => {
        const vtBinDir: string = path.join(tempDir, 'vt-bin')
        await fs.mkdir(vtBinDir, {recursive: true})

        configureAgentRuntime({
            env: {
                getProjectPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolderPath: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
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

    it('prepends $HOME/bin even when getVtBinDir is not registered', async () => {
        configureAgentRuntime({
            env: {
                getProjectPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolderPath: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
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

        // $HOME/bin is always injected (unless Windows) so git-gate shim is reachable
        if (process.platform !== 'win32') {
            const homeBin: string = path.join(os.homedir(), 'bin')
            expect(envVars.PATH.startsWith(homeBin + path.delimiter)).toBe(true)
        }
        expect(envVars.PATH).toContain('/usr/bin')
    })

    it('inherits a usable PATH when no PATH is injected and vt-bin is configured', async () => {
        const vtBinDir: string = path.join(tempDir, 'vt-bin')
        await fs.mkdir(vtBinDir, {recursive: true})
        process.env.PATH = '/custom/bin'

        configureAgentRuntime({
            env: {
                getProjectPaths: async (): Promise<readonly string[]> => [tempDir],
                getWriteFolderPath: async (): Promise<string | null> => tempDir,
                getProjectRoot: async (): Promise<string | null> => tempDir,
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

        // PATH = vtBinDir : $HOME/bin : inherited PATH : Unix baseline
        if (process.platform !== 'win32') {
            const homeBin: string = path.join(os.homedir(), 'bin')
            expect(envVars.PATH.startsWith(vtBinDir + path.delimiter + homeBin + path.delimiter)).toBe(true)
            expect(envVars.PATH).toContain('/custom/bin')
            expect(envVars.PATH).toContain('/usr/bin')
            expect(envVars.PATH).toContain('/bin')
        } else {
            expect(envVars.PATH).toBe(vtBinDir)
        }
    })
})

describe('prependHomeBinToPath (pure)', () => {
    it('prepends $HOME/bin on non-Windows platforms', () => {
        const result = prependHomeBinToPath({PATH: '/usr/bin'}, 'linux', '/home/alice')
        expect(result.PATH).toBe('/home/alice/bin' + path.delimiter + '/usr/bin')
    })

    it('is a no-op on Windows', () => {
        const input = {PATH: 'C:\\Windows\\System32'}
        expect(prependHomeBinToPath(input, 'win32', 'C:\\Users\\alice')).toEqual(input)
    })

    it('is idempotent — does not double-prepend on repeated calls', () => {
        const first = prependHomeBinToPath({PATH: '/usr/bin'}, 'darwin', '/home/alice')
        const second = prependHomeBinToPath(first, 'darwin', '/home/alice')
        expect(second.PATH).toBe(first.PATH)
    })

    it('sets PATH when it is absent', () => {
        const result = prependHomeBinToPath({OTHER: 'x'}, 'linux', '/home/alice')
        expect(result.PATH).toBe('/home/alice/bin')
        expect(result.OTHER).toBe('x')
    })
})
