import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {DirectoryEntry} from '@vt/graph-model/folders'
import {toAbsolutePath} from '@vt/graph-model/folders'
import {getDirectoryTree, getSubfoldersWithModifiedAt, isValidSubdirectory} from './folder-scanning.ts'

// Black-box: every assertion is on the value returned for a real on-disk tree.
let root: string

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'folder-scanning-'))
})
afterEach(() => {
    rmSync(root, {recursive: true, force: true})
})

function names(children: readonly DirectoryEntry[] | undefined): string[] {
    return (children ?? []).map((c) => c.name)
}

describe('getDirectoryTree', () => {
    it('builds a recursive tree, directories first then files, each alphabetical', async () => {
        mkdirSync(path.join(root, 'b-dir'))
        mkdirSync(path.join(root, 'a-dir'))
        writeFileSync(path.join(root, 'z.md'), '# z')
        writeFileSync(path.join(root, 'a.md'), '# a')
        writeFileSync(path.join(root, 'a-dir', 'nested.md'), '# nested')

        const tree = await getDirectoryTree(root)
        expect(tree.isDirectory).toBe(true)
        expect(names(tree.children)).toEqual(['a-dir', 'b-dir', 'a.md', 'z.md'])

        const aDir = (tree.children ?? []).find((c) => c.name === 'a-dir')
        expect(aDir?.isDirectory).toBe(true)
        expect(names(aDir?.children)).toEqual(['nested.md'])
    })

    it('skips dotfiles and ignored build directories', async () => {
        mkdirSync(path.join(root, 'node_modules'))
        mkdirSync(path.join(root, '.git'))
        mkdirSync(path.join(root, 'src'))
        writeFileSync(path.join(root, '.hidden'), 'x')

        const tree = await getDirectoryTree(root)
        expect(names(tree.children)).toEqual(['src'])
    })

    it('honours maxDepth, leaving deeper folders unexpanded', async () => {
        mkdirSync(path.join(root, 'a', 'b'), {recursive: true})
        writeFileSync(path.join(root, 'a', 'b', 'deep.md'), '# deep')

        const tree = await getDirectoryTree(root, 1)
        const a = (tree.children ?? []).find((c) => c.name === 'a')
        expect(a?.isDirectory).toBe(true)
        expect(a?.children ?? []).toEqual([]) // depth budget exhausted before descending into a/
    })
})

describe('getSubfoldersWithModifiedAt', () => {
    it('lists the root plus its non-hidden subfolders', async () => {
        mkdirSync(path.join(root, 'one'))
        mkdirSync(path.join(root, 'two'))
        mkdirSync(path.join(root, '.hidden'))
        const result = await getSubfoldersWithModifiedAt(toAbsolutePath(root))
        const paths = result.map((r) => path.basename(r.path)).sort()
        expect(paths).toEqual([path.basename(root), 'one', 'two'].sort())
    })

    it('returns [] for a missing directory', async () => {
        expect(await getSubfoldersWithModifiedAt(toAbsolutePath(path.join(root, 'nope')))).toEqual([])
    })
})

describe('isValidSubdirectory', () => {
    it('accepts a real subdirectory of the root', async () => {
        mkdirSync(path.join(root, 'sub'))
        expect(await isValidSubdirectory(root, path.join(root, 'sub'))).toBe(true)
    })
    it('rejects a path outside the root', async () => {
        const outside = mkdtempSync(path.join(os.tmpdir(), 'outside-'))
        try {
            expect(await isValidSubdirectory(root, outside)).toBe(false)
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })
    it('rejects a file', async () => {
        writeFileSync(path.join(root, 'f.md'), 'x')
        expect(await isValidSubdirectory(root, path.join(root, 'f.md'))).toBe(false)
    })
})
