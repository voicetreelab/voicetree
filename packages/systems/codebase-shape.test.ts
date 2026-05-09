import {readdir, readFile, stat} from 'node:fs/promises'
import {extname, dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')
const MAX_DIRECTORY_CHILDREN: number = 10
const MAX_FILE_LINES: number = 500
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx'])
const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'build',
    'coverage',
    'dist',
    'node_modules',
])

type DirectoryFanout = {
    readonly directory: string
    readonly childCount: number
    readonly children: readonly string[]
}

type FileLineCount = {
    readonly file: string
    readonly lineCount: number
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

async function discoverSystemSourceRoots(): Promise<string[]> {
    const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return []
        const packagePath = join(SYSTEMS_ROOT, entry.name, 'package.json')
        const sourceRoot = join(SYSTEMS_ROOT, entry.name, 'src')
        if (!(await pathExists(packagePath)) || !(await pathExists(sourceRoot))) return []
        return [sourceRoot]
    }))
    return nested.flat().sort()
}

function isIgnoredDirectoryName(name: string): boolean {
    return IGNORED_DIRECTORY_NAMES.has(name)
}

function isSourceFile(path: string): boolean {
    return SOURCE_EXTENSIONS.has(extname(path)) && !path.endsWith('.d.ts')
}

function countLines(text: string): number {
    if (text.length === 0) return 0
    return text.endsWith('\n')
        ? text.slice(0, -1).split(/\r\n|\n|\r/).length
        : text.split(/\r\n|\n|\r/).length
}

async function scanDirectoryFanout(root: string): Promise<DirectoryFanout[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const visibleEntries = entries
        .filter(entry => !(entry.isDirectory() && isIgnoredDirectoryName(entry.name)))
        .sort((a, b) => a.name.localeCompare(b.name))

    const current = {
        directory: relative(REPO_ROOT, root),
        childCount: visibleEntries.length,
        children: visibleEntries.map(entry => entry.name),
    }

    const nested = await Promise.all(visibleEntries.map(entry => {
        if (!entry.isDirectory()) return Promise.resolve([])
        return scanDirectoryFanout(join(root, entry.name))
    }))

    return [current, ...nested.flat()]
}

async function scanFileLineCounts(root: string): Promise<FileLineCount[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        if (entry.isDirectory()) {
            if (isIgnoredDirectoryName(entry.name)) return []
            return scanFileLineCounts(join(root, entry.name))
        }

        const file = join(root, entry.name)
        if (!entry.isFile() || !isSourceFile(file)) return []

        const text = await readFile(file, 'utf8')
        return [{
            file: relative(REPO_ROOT, file),
            lineCount: countLines(text),
        }]
    }))

    return nested.flat().sort((a, b) => a.file.localeCompare(b.file))
}

function formatDirectoryFanoutViolation(violation: DirectoryFanout): string {
    return [
        `${violation.directory}: ${violation.childCount} children`,
        `  ${violation.children.join(', ')}`,
    ].join('\n')
}

function formatFileLineViolation(violation: FileLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('systems codebase shape', () => {
    it('keeps every source directory at or below the immediate-child limit', async () => {
        const sourceRoots = await discoverSystemSourceRoots()
        const fanouts = (await Promise.all(sourceRoots.map(scanDirectoryFanout))).flat()
        const violations = fanouts
            .filter(fanout => fanout.childCount > MAX_DIRECTORY_CHILDREN)
            .sort((a, b) => b.childCount - a.childCount || a.directory.localeCompare(b.directory))

        expect(
            violations.map(formatDirectoryFanoutViolation).join('\n\n'),
        ).toBe('')
    })

    it('keeps every source file at or below the line limit', async () => {
        const sourceRoots = await discoverSystemSourceRoots()
        const lineCounts = (await Promise.all(sourceRoots.map(scanFileLineCounts))).flat()
        const violations = lineCounts
            .filter(lineCount => lineCount.lineCount > MAX_FILE_LINES)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))

        expect(
            violations.map(formatFileLineViolation).join('\n'),
        ).toBe('')
    })
})
