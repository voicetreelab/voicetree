import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b7} from '../../src/scenarios/b7.ts'

const FIXTURE_LEAF_COUNT = 135

describe('b7 — knowledge gardening', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b7-test-'))
    })
    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal', () => {
        expect(b7.id).toBe('B7')
        expect(b7.name).toMatch(/gardening/)
        expect(b7.taskPrompt).toMatch(/sub-task 1/i)
        expect(b7.taskPrompt).toMatch(/sub-task 2/i)
        expect(b7.taskPrompt).toMatch(/sub-task 3/i)
        expect(b7.taskPrompt).toMatch(/sub-task 4/i)
        const verbs = b7.expectedCommands.map((c) => c.verb)
        expect(verbs).toContain('graph create')
        expect(verbs).toContain('graph group')
        // graph create coverage is "did the agent use the verb at all" —
        // the success-criteria gates already verify the actual outcome.
        const createPattern = b7.expectedCommands.find((c) => c.verb === 'graph create')
        expect(createPattern?.minCount).toBeUndefined()
        expect(b7.budgets.vtInvocations).toBeGreaterThanOrEqual(150)
    })

    it('setup copies the fixture and creates .voicetree/', async () => {
        await b7.setup(tempDir)
        const dotvt = await fs.stat(path.join(tempDir, '.voicetree'))
        expect(dotvt.isDirectory()).toBe(true)
        const entries = await fs.readdir(tempDir)
        const leaves = entries.filter((n) => /^\d{3}-[a-z0-9-]+\.md$/.test(n))
        expect(leaves.length).toBe(FIXTURE_LEAF_COUNT)
    })

    it('successCriteria: all four checkpoints pass on a fully-gardened vault', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(true)
        expect(result.checkpoints).toBeDefined()
        expect(result.checkpoints?.map((c) => c.passed)).toEqual([true, true, true, true])
        expect(result.detail).toMatch(/4\/4/)
    })

    it('successCriteria: C1 fails when leaves are missing', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        // Delete one leaf after gardening.
        const folders = await listSubdirs(tempDir)
        const aFolder = folders[0]
        const leaves = (await fs.readdir(aFolder)).filter((n) => /^\d{3}-/.test(n))
        await fs.unlink(path.join(aFolder, leaves[0]))
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c1 = result.checkpoints?.find((c) => c.name === 'C1-leaves-on-disk')
        expect(c1?.passed).toBe(false)
        expect(c1?.detail).toMatch(/missing/)
    })

    it('successCriteria: C2 fails when leaves remain at vault root', async () => {
        await b7.setup(tempDir)
        // Garden only half the leaves; leave the rest at root.
        const allEntries = await fs.readdir(tempDir)
        const halfLeaves = allEntries
            .filter((n) => /^\d{3}-[a-z0-9-]+\.md$/.test(n))
            .slice(0, 70)
        await groupLeavesIntoFolders(tempDir, halfLeaves, 5)
        await writeFolderPathNotesFor(tempDir)
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c2 = result.checkpoints?.find((c) => c.name === 'C2-regrouped')
        expect(c2?.passed).toBe(false)
        expect(c2?.detail).toMatch(/still at vault root/)
    })

    it('successCriteria: C2 fails when too few folders are used', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 3) // below MIN_FOLDERS=5
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c2 = result.checkpoints?.find((c) => c.name === 'C2-regrouped')
        expect(c2?.passed).toBe(false)
        expect(c2?.detail).toMatch(/only 3 folders/)
    })

    it('successCriteria: C2 fails when too many folders are used', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 20) // above MAX_FOLDERS=15
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c2 = result.checkpoints?.find((c) => c.name === 'C2-regrouped')
        expect(c2?.passed).toBe(false)
        expect(c2?.detail).toMatch(/20 folders/)
    })

    it('successCriteria: C3 fails when a folder note is missing', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        // Delete one folder note.
        const folders = await listSubdirs(tempDir)
        const target = folders[0]
        await fs.unlink(path.join(target, `${path.basename(target)}.md`))
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c3 = result.checkpoints?.find((c) => c.name === 'C3-folder-notes')
        expect(c3?.passed).toBe(false)
        expect(c3?.detail).toMatch(/folder note.*missing/)
    })

    it('successCriteria: C3 fails when a leaf is orphaned (no folder-note wikilink)', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        // Strip wikilinks from one folder note → all its leaves go orphan.
        const folders = await listSubdirs(tempDir)
        const target = folders[0]
        const folderNotePath = path.join(target, `${path.basename(target)}.md`)
        await fs.writeFile(
            folderNotePath,
            `---\ntype: folder-note\n---\n# ${path.basename(target)}\n\nNo contents.\n`,
        )
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c3 = result.checkpoints?.find((c) => c.name === 'C3-folder-notes')
        expect(c3?.passed).toBe(false)
        expect(c3?.detail).toMatch(/unreachable/)
    })

    it('successCriteria: C3 fails when a leaf is wikilinked from two folder notes', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        // Take a leaf from folder A, wikilink it from folder B's note too.
        const folders = await listSubdirs(tempDir)
        const [folderA, folderB] = folders
        const aLeaves = (await fs.readdir(folderA)).filter((n) => /^\d{3}-/.test(n))
        const leafBasename = path.basename(aLeaves[0], '.md')
        const bNotePath = path.join(folderB, `${path.basename(folderB)}.md`)
        const bNote = await fs.readFile(bNotePath, 'utf8')
        await fs.writeFile(bNotePath, bNote + `\n- [[${leafBasename}]]\n`)
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c3 = result.checkpoints?.find((c) => c.name === 'C3-folder-notes')
        expect(c3?.passed).toBe(false)
        expect(c3?.detail).toMatch(/multiple folder notes/)
    })

    it('successCriteria: failure detail aggregates which checkpoints failed', async () => {
        await b7.setup(tempDir)
        // No gardening at all — every leaf at root, no folders, no notes,
        // no index. Only C1 should pass.
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/1\/4/)
        const c1 = result.checkpoints?.find((c) => c.name === 'C1-leaves-on-disk')
        expect(c1?.passed).toBe(true)
        const c4 = result.checkpoints?.find((c) => c.name === 'C4-root-index')
        expect(c4?.passed).toBe(false)
        expect(c4?.detail).toMatch(/index\.md is missing/)
    })

    it('successCriteria: C4 fails when index.md is missing from the vault root', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        await fs.unlink(path.join(tempDir, 'index.md'))
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c4 = result.checkpoints?.find((c) => c.name === 'C4-root-index')
        expect(c4?.passed).toBe(false)
        expect(c4?.detail).toMatch(/index\.md is missing/)
    })

    it('successCriteria: C4 fails when index.md does not wikilink every folder note', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 8)
        // Rewrite index.md to link only the first folder.
        const folders = await listSubdirs(tempDir)
        const firstFolder = path.basename(folders[0])
        const indexPath = path.join(tempDir, 'index.md')
        await fs.writeFile(
            indexPath,
            `---\ntype: index\n---\n# index\n\n## Folders\n- [[${firstFolder}/${firstFolder}]]\n`,
        )
        const result = await b7.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        const c4 = result.checkpoints?.find((c) => c.name === 'C4-root-index')
        expect(c4?.passed).toBe(false)
        expect(c4?.detail).toMatch(/missing wikilinks to \d+\/\d+ folder note/)
    })

    it('successCriteria: C4 accepts wikilinks written as <folder>/<folder>.md', async () => {
        await b7.setup(tempDir)
        await gardenVault(tempDir, 6)
        const folders = await listSubdirs(tempDir)
        const links = folders
            .map((f) => path.basename(f))
            .map((name) => `- [[${name}/${name}.md]]`)
            .join('\n')
        await fs.writeFile(
            path.join(tempDir, 'index.md'),
            `---\ntype: index\n---\n# index\n\n## Folders\n${links}\n`,
        )
        const result = await b7.successCriteria(tempDir)
        const c4 = result.checkpoints?.find((c) => c.name === 'C4-root-index')
        expect(c4?.passed).toBe(true)
    })
})

/**
 * Move every leaf at the vault root into one of `numFolders` directories
 * (round-robin), then write a folder note linking every leaf in that folder,
 * then write a root index.md wikilinking every folder note. Reproduces the
 * post-state shape of a fully-gardened vault.
 */
async function gardenVault(vaultDir: string, numFolders: number): Promise<void> {
    const entries = await fs.readdir(vaultDir)
    const leaves = entries.filter((n) => /^\d{3}-[a-z0-9-]+\.md$/.test(n))
    const folderNames = Array.from({length: numFolders}, (_, i) => `bucket-${i + 1}`)
    for (let i = 0; i < leaves.length; i++) {
        const folder = folderNames[i % numFolders]
        const folderPath = path.join(vaultDir, folder)
        await fs.mkdir(folderPath, {recursive: true})
        await fs.rename(path.join(vaultDir, leaves[i]), path.join(folderPath, leaves[i]))
    }
    await writeFolderPathNotesFor(vaultDir)
    await writeRootIndexFor(vaultDir)
}

/**
 * Write `index.md` at the vault root with wikilinks to every folder note.
 */
async function writeRootIndexFor(vaultDir: string): Promise<void> {
    const subdirs = await listSubdirs(vaultDir)
    const folderLinks: string[] = []
    for (const dir of subdirs) {
        const name = path.basename(dir)
        const folderNotePath = path.join(dir, `${name}.md`)
        try {
            await fs.stat(folderNotePath)
            folderLinks.push(`- [[${name}/${name}]]`)
        } catch {
            // Folder has no folder note (e.g. partial-garden tests) — skip.
        }
    }
    const body = [
        '---',
        'type: index',
        '---',
        '# index',
        '',
        '## Folders',
        ...folderLinks,
        '',
    ].join('\n')
    await fs.writeFile(path.join(vaultDir, 'index.md'), body)
}

async function groupLeavesIntoFolders(
    vaultDir: string,
    leafBasenames: readonly string[],
    numFolders: number,
): Promise<void> {
    const folderNames = Array.from({length: numFolders}, (_, i) => `bucket-${i + 1}`)
    for (let i = 0; i < leafBasenames.length; i++) {
        const folder = folderNames[i % numFolders]
        const folderPath = path.join(vaultDir, folder)
        await fs.mkdir(folderPath, {recursive: true})
        await fs.rename(
            path.join(vaultDir, leafBasenames[i]),
            path.join(folderPath, leafBasenames[i]),
        )
    }
}

/**
 * For every subdirectory that contains leaves, write a folder note at
 * `<folder>/<folder>.md` listing every leaf inside as a wikilink.
 */
async function writeFolderPathNotesFor(vaultDir: string): Promise<void> {
    const subdirs = await listSubdirs(vaultDir)
    for (const dir of subdirs) {
        const entries = await fs.readdir(dir)
        const leaves = entries.filter((n) => /^\d{3}-[a-z0-9-]+\.md$/.test(n))
        if (leaves.length === 0) continue
        const folderName = path.basename(dir)
        const body = [
            '---',
            'type: folder-note',
            '---',
            `# ${folderName}`,
            '',
            `Leaves grouped under ${folderName}.`,
            '',
            '## Contents',
            ...leaves.map((leaf) => `- [[${path.basename(leaf, '.md')}]]`),
            '',
        ].join('\n')
        await fs.writeFile(path.join(dir, `${folderName}.md`), body)
    }
}

async function listSubdirs(vaultDir: string): Promise<readonly string[]> {
    const entries = await fs.readdir(vaultDir, {withFileTypes: true})
    return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => path.join(vaultDir, e.name))
}
