import {readdir, readFile} from 'node:fs/promises'
import {extname, join, relative} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
// Hard design limit set 2026-05-15: a directory with more than 15 children
// is a signal it has stopped being a coherent module and should be split.
const MAX_DIRECTORY_CHILDREN: number = 15
// Captured 2026-05-14 after widening discovery to whole repo; ratchet down later.
const MAX_FILE_LINES: number = 1081
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

async function discoverSourceRoots(): Promise<string[]> {
    const packages = await discoverPackages()
    return packages.map(pkg => pkg.srcRoot).sort()
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

const DIRECTORY_FANOUT_REMEDIATION: string = [
    '',
    'Remediation:',
    `  A source directory holding more than ${MAX_DIRECTORY_CHILDREN} immediate children`,
    '  has stopped being a coherent module. Reorganise the listed directories',
    '  into subfolders that reflect the semantic / code structure (e.g. group',
    '  lifecycle files under `lifecycle/`, HTTP wiring under `server/`, state',
    '  files under `state/`). Update relative imports accordingly. Do NOT raise',
    '  the limit — that would be reward-hacking this gate.',
    '',
].join('\n')

function formatFileLineViolation(violation: FileLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('systems codebase shape', () => {
    it('keeps every source directory at or below the immediate-child limit', async () => {
        const sourceRoots = await discoverSourceRoots()
        const fanouts = (await Promise.all(sourceRoots.map(scanDirectoryFanout))).flat()
        const violations = fanouts
            .filter(fanout => fanout.childCount > MAX_DIRECTORY_CHILDREN)
            .sort((a, b) => b.childCount - a.childCount || a.directory.localeCompare(b.directory))
        const maxChildCount = fanouts.reduce((max, fanout) => Math.max(max, fanout.childCount), 0)

        await recordHealthMetric({
            metricId: 'codebase-directory-fanout',
            metricName: 'Directory Fanout',
            description: 'Largest immediate child count in systems source directories.',
            category: 'Structure',
            current: maxChildCount,
            budget: MAX_DIRECTORY_CHILDREN,
            comparison: 'lte',
            unit: 'children',
            details: {
                violations,
                topDirectories: fanouts.slice().sort((a, b) => b.childCount - a.childCount).slice(0, 20),
            },
        })

        const formattedViolations = violations.map(formatDirectoryFanoutViolation).join('\n\n')
        expect(
            formattedViolations === '' ? '' : `${formattedViolations}\n${DIRECTORY_FANOUT_REMEDIATION}`,
        ).toBe('')
    })

    it('keeps every source file at or below the line limit', async () => {
        const sourceRoots = await discoverSourceRoots()
        const lineCounts = (await Promise.all(sourceRoots.map(scanFileLineCounts))).flat()
        const violations = lineCounts
            .filter(lineCount => lineCount.lineCount > MAX_FILE_LINES)
            .sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
        const maxLineCount = lineCounts.reduce((max, lineCount) => Math.max(max, lineCount.lineCount), 0)

        await recordHealthMetric({
            metricId: 'codebase-file-lines',
            metricName: 'Source File Line Count',
            description: 'Largest source file line count under systems packages.',
            category: 'Structure',
            current: maxLineCount,
            budget: MAX_FILE_LINES,
            comparison: 'lte',
            unit: 'lines',
            details: {
                violations,
                largestFiles: lineCounts.slice().sort((a, b) => b.lineCount - a.lineCount).slice(0, 20),
            },
        })

        expect(
            violations.map(formatFileLineViolation).join('\n'),
        ).toBe('')
    })
})
