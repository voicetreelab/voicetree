import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {removePersistedAgentRecord, type RemovePersistedAgentRecordDeps} from '../removePersistedAgentRecord'

type DepsOverrides = Partial<RemovePersistedAgentRecordDeps>

function makeDeps(overrides: DepsOverrides = {}): RemovePersistedAgentRecordDeps {
    return {
        getProjectRoot: async () => '/project/root',
        isInLiveRegistry: () => false,
        unlinkPath: vi.fn(async () => undefined),
        ...overrides,
    }
}

// ---------------------------------------------------------------------------
// Validation: terminalId allowlist
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — id validation (§7.1)', () => {
    it.each([
        ['empty string', ''],
        ['parent traversal', '../foo'],
        ['relative segment', './foo'],
        ['absolute path', '/etc/passwd'],
        ['contains slash', 'foo/bar'],
        ['contains backslash', 'foo\\bar'],
        ['contains space', 'id with spaces'],
        ['contains dot', 'foo.bar'],
        ['contains shell metachar', 'foo;rm -rf'],
        ['contains null byte', 'foo\x00bar'],
        ['non-ascii letter', 'café'],
    ])('rejects malicious id (%s) with invalid-id BEFORE touching disk or registry', async (_label, malicious) => {
        const unlinkPath = vi.fn(async () => undefined)
        const isInLiveRegistry = vi.fn(() => false)
        const getProjectRoot = vi.fn(async () => '/project/root')
        const result = await removePersistedAgentRecord(malicious, {unlinkPath, isInLiveRegistry, getProjectRoot})

        expect(result).toEqual({kind: 'invalid-id'})
        // Validation must short-circuit before any IO / registry probe.
        expect(unlinkPath).not.toHaveBeenCalled()
        expect(isInLiveRegistry).not.toHaveBeenCalled()
        expect(getProjectRoot).not.toHaveBeenCalled()
    })

    it.each([
        ['simple alphanumeric', 'Iris'],
        ['underscore + dash', 'agent_test-42'],
        ['all digits', '12345'],
    ])('accepts safe id (%s)', async (_label, safe) => {
        const result = await removePersistedAgentRecord(safe, makeDeps())
        expect(result.kind).toBe('removed')
    })
})

// ---------------------------------------------------------------------------
// Live registry refusal
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — live registry refusal (§7.1 spec scenario)', () => {
    it('refuses with reason "live-registry-entry" when the id is currently registered', async () => {
        const unlinkPath = vi.fn(async () => undefined)
        const result = await removePersistedAgentRecord('Ama', makeDeps({
            isInLiveRegistry: (id) => id === 'Ama',
            unlinkPath,
        }))

        expect(result).toEqual({kind: 'refused', reason: 'live-registry-entry'})
        expect(unlinkPath).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// Project root missing
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — project root missing', () => {
    it('refuses with reason "no-project-root" when the runtime env returns null', async () => {
        const unlinkPath = vi.fn(async () => undefined)
        const result = await removePersistedAgentRecord('Iris', makeDeps({
            getProjectRoot: async () => null,
            unlinkPath,
        }))

        expect(result).toEqual({kind: 'refused', reason: 'no-project-root'})
        expect(unlinkPath).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// Path construction + canonicalisation (in-memory deps)
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — path construction', () => {
    it('unlinks JSON + log + prompt + exitcode siblings under <projectRoot>/.voicetree/terminals/', async () => {
        const unlinked: string[] = []
        const result = await removePersistedAgentRecord('Iris', makeDeps({
            unlinkPath: async (p: string): Promise<void> => {
                unlinked.push(p)
            },
        }))

        expect(result).toEqual({kind: 'removed'})
        const expectedBase: string = path.join('/project/root', '.voicetree', 'terminals')
        expect(unlinked.sort()).toEqual([
            path.join(expectedBase, 'Iris-prompt.txt'),
            path.join(expectedBase, 'Iris.exitcode'),
            path.join(expectedBase, 'Iris.json'),
            path.join(expectedBase, 'Iris.log'),
        ])
    })

    it('only uses paths that canonicalise inside the metadata dir (defence in depth)', async () => {
        // The regex already rejects `..`, but if a future refactor relaxed the
        // guard, the canonicalisation check would still catch escape attempts.
        const unlinked: string[] = []
        // Caller passes a project root *containing* a literal `..` segment in
        // its resolved form to ensure the final paths still match the joined
        // dir, not some traversed location.
        const result = await removePersistedAgentRecord('Iris', makeDeps({
            getProjectRoot: async () => '/project/root/sub/..',
            unlinkPath: async (p: string): Promise<void> => { unlinked.push(p) },
        }))

        expect(result).toEqual({kind: 'removed'})
        for (const p of unlinked) {
            expect(p.startsWith(path.resolve('/project/root/sub/..', '.voicetree', 'terminals'))).toBe(true)
        }
    })
})

// ---------------------------------------------------------------------------
// Idempotence: missing files do not error
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — idempotence (§7.3 spec scenario)', () => {
    it('returns removed even when every sibling is missing (ENOENT swallowed)', async () => {
        const result = await removePersistedAgentRecord('Gone', makeDeps({
            unlinkPath: async (): Promise<void> => {
                const error = new Error('ENOENT') as Error & {code: string}
                error.code = 'ENOENT'
                throw error
            },
        }))

        expect(result).toEqual({kind: 'removed'})
    })

    it('re-throws unlink failures that are not ENOENT (so disk errors do not silently corrupt state)', async () => {
        await expect(removePersistedAgentRecord('Boom', makeDeps({
            unlinkPath: async (): Promise<void> => {
                const error = new Error('EACCES') as Error & {code: string}
                error.code = 'EACCES'
                throw error
            },
        }))).rejects.toThrow('EACCES')
    })
})

// ---------------------------------------------------------------------------
// Real-disk roundtrip: removes JSON + siblings end-to-end
// ---------------------------------------------------------------------------

describe('removePersistedAgentRecord — real filesystem roundtrip', () => {
    let projectRoot: string

    beforeEach(async () => {
        projectRoot = await mkdtemp(path.join(tmpdir(), 'remove-record-'))
    })

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true})
    })

    it('removes JSON + sibling artifacts from <projectRoot>/.voicetree/terminals/', async () => {
        const dir: string = path.join(projectRoot, '.voicetree', 'terminals')
        await mkdir(dir, {recursive: true})
        await writeFile(path.join(dir, 'Iris.json'), '{}')
        await writeFile(path.join(dir, 'Iris.log'), 'log contents')
        await writeFile(path.join(dir, 'Iris-prompt.txt'), 'prompt contents')
        await writeFile(path.join(dir, 'Iris.exitcode'), '0')
        // Untouched neighbour — confirms we only delete matching id, not the whole dir.
        await writeFile(path.join(dir, 'Other.json'), '{}')

        const result = await removePersistedAgentRecord('Iris', makeDeps({
            getProjectRoot: async () => projectRoot,
            unlinkPath: async (p) => {
                // Delegate to real fs.unlink so we can observe disk state.
                const {unlink} = await import('node:fs/promises')
                await unlink(p)
            },
        }))

        expect(result).toEqual({kind: 'removed'})
        expect(existsSync(path.join(dir, 'Iris.json'))).toBe(false)
        expect(existsSync(path.join(dir, 'Iris.log'))).toBe(false)
        expect(existsSync(path.join(dir, 'Iris-prompt.txt'))).toBe(false)
        expect(existsSync(path.join(dir, 'Iris.exitcode'))).toBe(false)
        // Other terminal untouched
        expect(existsSync(path.join(dir, 'Other.json'))).toBe(true)
        // No other files were created in the dir
        const remaining: readonly string[] = await readdir(dir)
        expect([...remaining].sort()).toEqual(['Other.json'])
    })

    it('removes the JSON when sibling artifacts never existed (selective unlink, no errors)', async () => {
        const dir: string = path.join(projectRoot, '.voicetree', 'terminals')
        await mkdir(dir, {recursive: true})
        await writeFile(path.join(dir, 'Solo.json'), '{}')
        // no .log / -prompt.txt / .exitcode

        const result = await removePersistedAgentRecord('Solo', makeDeps({
            getProjectRoot: async () => projectRoot,
            unlinkPath: async (p) => {
                const {unlink} = await import('node:fs/promises')
                await unlink(p)
            },
        }))

        expect(result).toEqual({kind: 'removed'})
        expect(existsSync(path.join(dir, 'Solo.json'))).toBe(false)
    })

    it('is idempotent when called twice in a row', async () => {
        const dir: string = path.join(projectRoot, '.voicetree', 'terminals')
        await mkdir(dir, {recursive: true})
        await writeFile(path.join(dir, 'Twice.json'), '{}')

        const deps: RemovePersistedAgentRecordDeps = makeDeps({
            getProjectRoot: async () => projectRoot,
            unlinkPath: async (p) => {
                const {unlink} = await import('node:fs/promises')
                await unlink(p)
            },
        })

        const first = await removePersistedAgentRecord('Twice', deps)
        const second = await removePersistedAgentRecord('Twice', deps)

        expect(first).toEqual({kind: 'removed'})
        expect(second).toEqual({kind: 'removed'})
        expect(existsSync(path.join(dir, 'Twice.json'))).toBe(false)
    })
})
