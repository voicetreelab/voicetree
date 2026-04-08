import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {graphMove} from '../src/move'
import {graphRename} from '../src/rename'

async function captureJsonOutput(run: () => Promise<void>): Promise<any> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
        await run()
        const [payload] = logSpy.mock.calls.at(-1) ?? []
        return JSON.parse(String(payload))
    } finally {
        logSpy.mockRestore()
    }
}

async function captureHumanOutput(run: () => Promise<void>): Promise<string> {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', {value: true, configurable: true})

    try {
        await run()
        const [payload] = logSpy.mock.calls.at(-1) ?? []
        return String(payload)
    } finally {
        Object.defineProperty(process.stdout, 'isTTY', {value: originalIsTTY, configurable: true})
        logSpy.mockRestore()
    }
}

describe('graph move commands', () => {
    const tempDirs: string[] = []

    afterEach(() => {
        for (const tempDir of tempDirs) {
            rmSync(tempDir, {recursive: true, force: true})
        }
        tempDirs.length = 0
    })

    it('renames a file and updates wikilinks', async () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-rename-'))
        tempDirs.push(tempDir)

        writeFileSync(path.join(tempDir, 'alpha.md'), '# Alpha\n\n[[alpha]]\n')
        writeFileSync(path.join(tempDir, 'index.md'), '# Index\n\n[[alpha]]\n')

        const result = await captureJsonOutput(() =>
            graphRename(0, undefined, [
                path.join(tempDir, 'alpha.md'),
                path.join(tempDir, 'beta.md'),
                '--vault',
                tempDir,
            ])
        )

        expect(result.kind).toBe('file')
        expect(result.movedMarkdownFiles).toBe(1)
        expect(result.movedFiles).toEqual([{from: 'alpha.md', to: 'beta.md'}])
        expect(result).not.toHaveProperty('sourcePath')
        expect(result).not.toHaveProperty('destinationPath')
        expect(result).not.toHaveProperty('filesScanned')
        expect(result.warnings).toEqual([])
        expect(result.nonMarkdownFiles).toEqual([])
        expect(existsSync(path.join(tempDir, 'alpha.md'))).toBe(false)
        expect(existsSync(path.join(tempDir, 'beta.md'))).toBe(true)
        expect(readFileSync(path.join(tempDir, 'beta.md'), 'utf8')).toContain('[[beta]]')
        expect(readFileSync(path.join(tempDir, 'index.md'), 'utf8')).toContain('[[beta]]')
    })

    it('moves a folder recursively and updates path-based references', async () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-move-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'topics', 'source', 'nested'), {recursive: true})
        mkdirSync(path.join(tempDir, 'archive'), {recursive: true})

        const sourceRoot = path.join(tempDir, 'topics', 'source')
        const destinationRoot = path.join(tempDir, 'archive', 'source')
        const oldAPath = path.join(sourceRoot, 'a.md')
        const assetPath = path.join(sourceRoot, 'asset.png')

        writeFileSync(
            path.join(sourceRoot, 'a.md'),
            '# A\n\n[[topics/source/nested/b]]\n'
        )
        writeFileSync(
            path.join(sourceRoot, 'nested', 'b.md'),
            '# B\n'
        )
        writeFileSync(assetPath, 'fake image data')
        writeFileSync(
            path.join(tempDir, 'index.md'),
            `# Index\n\n[[topics/source/a]]\n[[topics/source/nested/b.md|B]]\n~/brain/topics/source/a.md\n${oldAPath}\n`
        )

        const result = await captureJsonOutput(() =>
            graphMove(0, undefined, [sourceRoot, destinationRoot, '--vault', tempDir])
        )

        expect(result.kind).toBe('folder')
        expect(result.movedMarkdownFiles).toBe(2)
        expect(result.movedFiles).toEqual([
            {from: 'topics/source/a.md', to: 'archive/source/a.md'},
            {from: 'topics/source/nested/b.md', to: 'archive/source/nested/b.md'},
        ])
        expect(result.warnings).toEqual([
            '1 non-Markdown file will also be moved without reference updates.',
        ])
        expect(result.nonMarkdownFiles).toEqual(['topics/source/asset.png'])
        expect(existsSync(sourceRoot)).toBe(false)
        expect(existsSync(path.join(destinationRoot, 'a.md'))).toBe(true)
        expect(existsSync(path.join(destinationRoot, 'nested', 'b.md'))).toBe(true)
        expect(existsSync(path.join(destinationRoot, 'asset.png'))).toBe(true)
        expect(readFileSync(path.join(destinationRoot, 'a.md'), 'utf8')).toContain('[[archive/source/nested/b]]')

        const indexContent = readFileSync(path.join(tempDir, 'index.md'), 'utf8')
        expect(indexContent).toContain('[[archive/source/a]]')
        expect(indexContent).toContain('[[archive/source/nested/b.md|B]]')
        expect(indexContent).toContain('~/brain/archive/source/a.md')
        expect(indexContent).toContain(path.join(destinationRoot, 'a.md'))
    })

    it('prints human-readable dry-run output', async () => {
        const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vt-graph-move-human-'))
        tempDirs.push(tempDir)

        mkdirSync(path.join(tempDir, 'topics', 'source', 'nested'), {recursive: true})
        mkdirSync(path.join(tempDir, 'archive'), {recursive: true})

        const sourceRoot = path.join(tempDir, 'topics', 'source')
        const destinationRoot = path.join(tempDir, 'archive', 'source')

        writeFileSync(path.join(sourceRoot, 'a.md'), '# A\n')
        writeFileSync(path.join(sourceRoot, 'nested', 'b.md'), '# B\n')
        writeFileSync(path.join(sourceRoot, 'asset.png'), 'fake image data')
        writeFileSync(path.join(tempDir, 'index.md'), '# Index\n\n[[topics/source/a]]\n')

        const output = await captureHumanOutput(() =>
            graphMove(0, undefined, [sourceRoot, destinationRoot, '--dry-run', '--vault', tempDir])
        )

        expect(output).toContain('Would move folder (2 files, 1 reference updated):')
        expect(output).toContain('topics/source/a.md -> archive/source/a.md')
        expect(output).toContain('topics/source/nested/b.md -> archive/source/nested/b.md')
        expect(output).toContain('References updated:')
        expect(output).toContain('index.md (1)')
        expect(output).toContain('Warnings:')
        expect(output).toContain('1 non-Markdown file would also be moved without reference updates.')
        expect(output).toContain('topics/source/asset.png')
        expect(existsSync(sourceRoot)).toBe(true)
        expect(existsSync(destinationRoot)).toBe(false)
    })
})
