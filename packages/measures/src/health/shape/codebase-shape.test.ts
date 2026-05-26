import {readdir, readFile} from 'node:fs/promises'
import {extname, join, relative} from 'node:path'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../_shared/discovery/discover-packages'
import {
    MAX_DIRECTORY_CHILDREN,
    IGNORED_DIRECTORY_NAMES,
    findFanoutViolations,
    formatFanoutReport,
    type DirectoryFanout,
} from '../../_shared/shape/directory-fanout'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
// Captured 2026-05-14 after widening discovery to whole repo; ratchet down later.
const MAX_FILE_LINES: number = 1081
const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx'])

type FileLineCount = {
    readonly file: string
    readonly lineCount: number
}

async function discoverSourceRoots(): Promise<string[]> {
    const packages = await discoverPackages()
    return packages.map(pkg => pkg.srcRoot).sort()
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
        .filter(entry => !(entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)))
        .sort((a, b) => a.name.localeCompare(b.name))

    const current: DirectoryFanout = {
        directory: relative(REPO_ROOT, root),
        childCount: visibleEntries.length,
        children: visibleEntries.map(entry => entry.name),
    }

    const nested = await Promise.all(visibleEntries.map(entry => {
        if (!entry.isDirectory()) return Promise.resolve<DirectoryFanout[]>([])
        return scanDirectoryFanout(join(root, entry.name))
    }))

    return [current, ...nested.flat()]
}

async function scanFileLineCounts(root: string): Promise<FileLineCount[]> {
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        if (entry.isDirectory()) {
            if (IGNORED_DIRECTORY_NAMES.has(entry.name)) return []
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

function formatFileLineViolation(violation: FileLineCount): string {
    return `${violation.file}: ${violation.lineCount} lines`
}

describe('systems codebase shape', () => {
    it('keeps every source directory at or below the immediate-child limit', async () => {
        const sourceRoots = await discoverSourceRoots()
        const fanouts = (await Promise.all(sourceRoots.map(scanDirectoryFanout))).flat()
        const violations = findFanoutViolations(fanouts)
        const maxChildCount = fanouts.reduce((max, f) => Math.max(max, f.childCount), 0)
        const topDirectories = fanouts.slice().sort((a, b) => b.childCount - a.childCount).slice(0, 20)

        await recordHealthMetric({
            metricId: 'codebase-directory-fanout',
            metricName: 'Directory Fanout',
            description: 'Largest immediate child count in systems source directories.',
            category: 'Structure',
            current: maxChildCount,
            budget: MAX_DIRECTORY_CHILDREN,
            comparison: 'lte',
            unit: 'children',
            details: {violations, topDirectories},
        })

        expect(formatFanoutReport(violations)).toBe('')
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
