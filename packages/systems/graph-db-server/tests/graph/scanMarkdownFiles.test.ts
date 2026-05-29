/**
 * Black-box tests for scanMarkdownFiles.
 *
 * Bug: scanMarkdownFiles used to recurse into hidden directories
 * (e.g. `.voicetree/prompts/`), causing per-project tooling files to
 * appear as nodes in the graph when a project root was scanned.
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import * as path from 'path'

import { scanMarkdownFiles } from '../../src/data/graph/loading/loadGraphFromDisk.ts'

const tempDirs: string[] = []

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir: string | undefined = tempDirs.pop()
        if (dir) fsSync.rmSync(dir, { recursive: true, force: true })
    }
})

async function makeTmp(): Promise<string> {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-md-'))
    tempDirs.push(dir)
    return dir
}

describe('scanMarkdownFiles', () => {
    it('does not return .md files inside hidden directories like .voicetree/', async () => {
        const root: string = await makeTmp()
        await fs.writeFile(path.join(root, 'visible.md'), '# visible')
        await fs.mkdir(path.join(root, '.voicetree', 'prompts'), { recursive: true })
        await fs.writeFile(
            path.join(root, '.voicetree', 'prompts', 'SUBAGENT_PROMPT.md'),
            '# Subtask',
        )
        await fs.writeFile(
            path.join(root, '.voicetree', 'prompts', 'decompose_subtask_dependency_graph.md'),
            '# Decomposing Tasks into Dependency Graphs',
        )

        const result: readonly string[] = await scanMarkdownFiles(root)

        expect(result).toEqual(['visible.md'])
        expect(result.some((p: string) => p.includes('.voicetree'))).toBe(false)
    })

    it('does not return .md files inside any hidden directory (e.g. .git/, .obsidian/)', async () => {
        const root: string = await makeTmp()
        await fs.writeFile(path.join(root, 'note.md'), '# note')
        await fs.mkdir(path.join(root, '.git'), { recursive: true })
        await fs.writeFile(path.join(root, '.git', 'leak.md'), 'leak')
        await fs.mkdir(path.join(root, '.obsidian'), { recursive: true })
        await fs.writeFile(path.join(root, '.obsidian', 'config.md'), 'config')

        const result: readonly string[] = await scanMarkdownFiles(root)

        expect(result).toEqual(['note.md'])
    })

    it('does not return .md files inside node_modules/', async () => {
        const root: string = await makeTmp()
        await fs.writeFile(path.join(root, 'note.md'), '# note')
        await fs.mkdir(path.join(root, 'node_modules', 'some-pkg'), { recursive: true })
        await fs.writeFile(
            path.join(root, 'node_modules', 'some-pkg', 'README.md'),
            '# pkg readme',
        )

        const result: readonly string[] = await scanMarkdownFiles(root)

        expect(result).toEqual(['note.md'])
    })

    it('still returns visible .md files in non-hidden subdirectories', async () => {
        const root: string = await makeTmp()
        await fs.writeFile(path.join(root, 'top.md'), '# top')
        await fs.mkdir(path.join(root, 'subfolder', 'nested'), { recursive: true })
        await fs.writeFile(path.join(root, 'subfolder', 'a.md'), '# a')
        await fs.writeFile(path.join(root, 'subfolder', 'nested', 'b.md'), '# b')

        const result: readonly string[] = await scanMarkdownFiles(root)

        expect([...result].sort()).toEqual([
            path.join('subfolder', 'a.md'),
            path.join('subfolder', 'nested', 'b.md'),
            'top.md',
        ].sort())
    })
})
