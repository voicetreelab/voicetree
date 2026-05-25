import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, relative} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {walkDirectories} from './walk-directories'

const tmpRoots: string[] = []

describe('walkDirectories', () => {
    afterEach(async () => {
        await Promise.all(tmpRoots.splice(0).map(root => rm(root, {recursive: true, force: true})))
    })

    it('returns a deterministic tree of directories and entries', async () => {
        const root = await createTmpRoot()
        await mkdir(join(root, 'z-dir'))
        await mkdir(join(root, 'a-dir', 'nested'), {recursive: true})
        await writeFile(join(root, 'b.ts'), '')
        await writeFile(join(root, 'a-dir', 'nested', 'c.tsx'), '')

        const walked = await walkDirectories(root)

        expect(summarizeWalk(root, walked)).toEqual([
            {
                directory: '.',
                entries: ['directory:a-dir', 'file:b.ts', 'directory:z-dir'],
            },
            {
                directory: 'a-dir',
                entries: ['directory:a-dir/nested'],
            },
            {
                directory: 'a-dir/nested',
                entries: ['file:a-dir/nested/c.tsx'],
            },
            {
                directory: 'z-dir',
                entries: [],
            },
        ])
    })

    it('filters entries before reporting or descending into them', async () => {
        const root = await createTmpRoot()
        await mkdir(join(root, 'keep'))
        await mkdir(join(root, 'skip'))
        await writeFile(join(root, 'keep', 'included.ts'), '')
        await writeFile(join(root, 'skip', 'excluded.ts'), '')

        const walked = await walkDirectories(root, {
            includeEntry: entry => entry.name !== 'skip',
        })

        expect(summarizeWalk(root, walked)).toEqual([
            {
                directory: '.',
                entries: ['directory:keep'],
            },
            {
                directory: 'keep',
                entries: ['file:keep/included.ts'],
            },
        ])
    })
})

async function createTmpRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'walk-directories-'))
    tmpRoots.push(root)
    return root
}

function summarizeWalk(
    root: string,
    walked: Awaited<ReturnType<typeof walkDirectories>>,
): Array<{directory: string; entries: string[]}> {
    return walked.map(directory => ({
        directory: relative(root, directory.absolutePath) || '.',
        entries: directory.entries.map(entry => `${entry.kind}:${relative(root, entry.absolutePath)}`),
    }))
}
