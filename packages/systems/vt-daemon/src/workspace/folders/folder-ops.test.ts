import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {GraphNode} from '@vt/graph-model/graph'
import {copyNodeToFolder, createSubfolder} from './folder-ops.ts'

let root: string

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'folder-ops-'))
})
afterEach(() => {
    rmSync(root, {recursive: true, force: true})
})

describe('createSubfolder', () => {
    it('creates the folder and reports its path', async () => {
        const result = await createSubfolder(root, 'notes')
        expect(result.success).toBe(true)
        expect(result.path).toBe(path.join(root, 'notes'))
        expect(statSync(path.join(root, 'notes')).isDirectory()).toBe(true)
    })

    it('rejects names containing a path separator without touching disk', async () => {
        const result = await createSubfolder(root, 'a/b')
        expect(result.success).toBe(false)
        expect(result.error).toBe('Invalid folder name')
        expect(existsSync(path.join(root, 'a'))).toBe(false)
    })

    it('rejects an empty name', async () => {
        expect((await createSubfolder(root, '')).success).toBe(false)
    })
})

// Minimal node: getNodeTitle only reads these two fields.
function nodeWithTitleContent(content: string, idPath: string): GraphNode {
    return {
        contentWithoutYamlOrLinks: content,
        absoluteFilePathIsID: idPath,
    } as unknown as GraphNode
}

describe('copyNodeToFolder', () => {
    it('copies the node markdown into the target, named after the slugged title', async () => {
        const sourceId = path.join(root, 'source.md')
        writeFileSync(sourceId, '# Hello World\n\nbody text')
        const target = path.join(root, 'dest')
        await createSubfolder(root, 'dest')

        const result = await copyNodeToFolder(
            nodeWithTitleContent('# Hello World\n\nbody text', sourceId),
            sourceId,
            target,
        )

        expect(result.success).toBe(true)
        expect(result.targetPath).toBe(path.join(target, 'hello-world.md'))
        expect(readFileSync(path.join(target, 'hello-world.md'), 'utf-8')).toBe('# Hello World\n\nbody text')
    })

    it('reports an error when the node does not exist', async () => {
        const result = await copyNodeToFolder(undefined, path.join(root, 'missing.md'), root)
        expect(result.success).toBe(false)
        expect(result.error).toContain('Node not found')
    })

    it('reports an error when the target folder is absent (no copy made)', async () => {
        const sourceId = path.join(root, 'source.md')
        writeFileSync(sourceId, '# Title')
        const result = await copyNodeToFolder(
            nodeWithTitleContent('# Title', sourceId),
            sourceId,
            path.join(root, 'does-not-exist'),
        )
        expect(result.success).toBe(false)
        expect(existsSync(path.join(root, 'does-not-exist'))).toBe(false)
    })
})
