/**
 * Black-box tests for the home-prompts mirror+backup. Assert on the observable
 * filesystem (symlink targets, stashed override content, pruned dangles, backup
 * dir naming), never on internal calls.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'
import {
    ensureHomePrompts,
    formatBackupTimestamp,
    mirrorPromptsAsSymlinks,
} from '../ensureHomePrompts'

let root: string
let source: string
let dest: string
let backupBase: string

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-home-prompts-'))
    source = path.join(root, 'source')
    dest = path.join(root, 'dest')
    backupBase = path.join(root, '.backup', 'prompts', '2026-05-30T13-30-59Z')
    await fs.mkdir(source, {recursive: true})
    await fs.writeFile(path.join(source, 'AGENT_PROMPT_CORE.md'), 'CORE')
    await fs.writeFile(path.join(source, 'addProgressTree.md'), 'TREE')
})

afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true})
})

describe('formatBackupTimestamp', () => {
    it('produces a Windows-safe, lexicographically-sortable UTC stamp', () => {
        expect(formatBackupTimestamp(new Date('2026-05-30T13:30:59.123Z'))).toBe('2026-05-30T13-30-59Z')
        // Lexical order == chronological order.
        const earlier: string = formatBackupTimestamp(new Date('2026-05-30T13:30:58.000Z'))
        const later: string = formatBackupTimestamp(new Date('2026-05-30T13:30:59.000Z'))
        expect(earlier < later).toBe(true)
    })
})

describe('mirrorPromptsAsSymlinks', () => {
    it('symlinks every source file so source edits propagate without re-copy', async () => {
        const result = await mirrorPromptsAsSymlinks(source, dest, backupBase)

        expect(result.backedUp).toEqual([])
        expect((await fs.lstat(path.join(dest, 'AGENT_PROMPT_CORE.md'))).isSymbolicLink()).toBe(true)
        expect(await fs.readFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('CORE')
        // A later source edit is visible immediately (no drift).
        await fs.writeFile(path.join(source, 'AGENT_PROMPT_CORE.md'), 'CORE-edited')
        expect(await fs.readFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('CORE-edited')
        // No override → no backup dir created.
        await expect(fs.access(path.join(root, '.backup'))).rejects.toThrow()
    })

    it('repoints a stale symlink at the current source', async () => {
        await fs.mkdir(dest, {recursive: true})
        const elsewhere: string = path.join(root, 'elsewhere.md')
        await fs.writeFile(elsewhere, 'OLD')
        await fs.symlink(elsewhere, path.join(dest, 'AGENT_PROMPT_CORE.md'))

        await mirrorPromptsAsSymlinks(source, dest, backupBase)

        expect(await fs.readlink(path.join(dest, 'AGENT_PROMPT_CORE.md'))).toBe(path.join(source, 'AGENT_PROMPT_CORE.md'))
        expect(await fs.readFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('CORE')
    })

    it('stashes a user override in the backup dir and re-symlinks (shipped prompt wins)', async () => {
        await fs.mkdir(dest, {recursive: true})
        await fs.writeFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'USER_OVERRIDE')

        const result = await mirrorPromptsAsSymlinks(source, dest, backupBase)

        // The override no longer wins: dest is now a symlink to the shipped source.
        expect(result.backedUp).toEqual(['AGENT_PROMPT_CORE.md'])
        expect((await fs.lstat(path.join(dest, 'AGENT_PROMPT_CORE.md'))).isSymbolicLink()).toBe(true)
        expect(await fs.readFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('CORE')
        // The override's content survives under the injected backup dir.
        expect(await fs.readFile(path.join(backupBase, 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('USER_OVERRIDE')
        // The sibling without an override is still linked.
        expect((await fs.lstat(path.join(dest, 'addProgressTree.md'))).isSymbolicLink()).toBe(true)
    })

    it('collision-guards the backup dir when the base path is already taken', async () => {
        await fs.mkdir(backupBase, {recursive: true})
        await fs.mkdir(dest, {recursive: true})
        await fs.writeFile(path.join(dest, 'AGENT_PROMPT_CORE.md'), 'USER_OVERRIDE')

        await mirrorPromptsAsSymlinks(source, dest, backupBase)

        // Base dir was occupied → the override lands in the `-1` sibling.
        expect(await fs.readFile(`${backupBase}-1/AGENT_PROMPT_CORE.md`, 'utf-8')).toBe('USER_OVERRIDE')
    })

    it('prunes a dangling symlink whose source file was removed', async () => {
        await mirrorPromptsAsSymlinks(source, dest, backupBase)
        await fs.rm(path.join(source, 'addProgressTree.md'))

        await mirrorPromptsAsSymlinks(source, dest, backupBase)

        await expect(fs.lstat(path.join(dest, 'addProgressTree.md'))).rejects.toThrow()
        expect((await fs.lstat(path.join(dest, 'AGENT_PROMPT_CORE.md'))).isSymbolicLink()).toBe(true)
    })

    it('is a silent no-op when the source dir is absent', async () => {
        const result = await mirrorPromptsAsSymlinks(path.join(root, 'nope'), dest, backupBase)
        expect(result.backedUp).toEqual([])
    })
})

describe('ensureHomePrompts', () => {
    it('mirrors into <home>/prompts and backs up overrides under <home>/.backup/prompts/<ts>', async () => {
        const home: string = path.join(root, 'home')
        await fs.mkdir(path.join(home, 'prompts'), {recursive: true})
        await fs.writeFile(path.join(home, 'prompts', 'AGENT_PROMPT_CORE.md'), 'USER_OVERRIDE')

        const result = await ensureHomePrompts({
            promptsSource: source,
            voicetreeHome: home,
            now: new Date('2026-05-30T13:30:59.123Z'),
        })

        expect(result.backedUp).toEqual(['AGENT_PROMPT_CORE.md'])
        expect(await fs.readFile(path.join(home, 'prompts', 'AGENT_PROMPT_CORE.md'), 'utf-8')).toBe('CORE')
        expect(
            await fs.readFile(path.join(home, '.backup', 'prompts', '2026-05-30T13-30-59Z', 'AGENT_PROMPT_CORE.md'), 'utf-8'),
        ).toBe('USER_OVERRIDE')
    })
})
