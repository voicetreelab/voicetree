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

        writeFileSync(
            path.join(sourceRoot, 'a.md'),
            '# A\n\n[[topics/source/nested/b]]\n'
        )
        writeFileSync(
            path.join(sourceRoot, 'nested', 'b.md'),
            '# B\n'
        )
        writeFileSync(
            path.join(tempDir, 'index.md'),
            `# Index\n\n[[topics/source/a]]\n[[topics/source/nested/b.md|B]]\n~/brain/topics/source/a.md\n${oldAPath}\n`
        )

        const result = await captureJsonOutput(() =>
            graphMove(0, undefined, [sourceRoot, destinationRoot, '--vault', tempDir])
        )

        expect(result.kind).toBe('folder')
        expect(result.movedMarkdownFiles).toBe(2)
        expect(existsSync(sourceRoot)).toBe(false)
        expect(existsSync(path.join(destinationRoot, 'a.md'))).toBe(true)
        expect(existsSync(path.join(destinationRoot, 'nested', 'b.md'))).toBe(true)
        expect(readFileSync(path.join(destinationRoot, 'a.md'), 'utf8')).toContain('[[archive/source/nested/b]]')

        const indexContent = readFileSync(path.join(tempDir, 'index.md'), 'utf8')
        expect(indexContent).toContain('[[archive/source/a]]')
        expect(indexContent).toContain('[[archive/source/nested/b.md|B]]')
        expect(indexContent).toContain('~/brain/archive/source/a.md')
        expect(indexContent).toContain(path.join(destinationRoot, 'a.md'))
    })
})
