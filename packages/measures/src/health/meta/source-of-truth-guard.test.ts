import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {runGitWorktreeCommand} from '../../_shared/run-git'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mjs', '.cjs', '.js']
const EXCLUDED_PREFIXES: readonly string[] = [
    'brain/',
    'health-dashboard/reports/',
    'node_modules/',
    '.git/',
]

type WriterPattern = {
    readonly name: string
    readonly pattern: RegExp
}

type SourceOfTruthFinding = {
    readonly file: string
    readonly pattern: string
}

const ALLOWED_DEFINITION_FILES: ReadonlyMap<string, string> = new Map([
    ['recordCheckReport', 'packages/measures/src/_shared/writers/check-report-writer.ts'],
    ['recordHealthReport', 'packages/measures/src/_shared/writers/health-report-writer.ts'],
])

const WRITER_DEFINITION_PATTERNS: readonly WriterPattern[] = [
    {
        name: 'recordCheckReport function definition',
        pattern: /\bfunction\s+recordCheckReport\s*\(/,
    },
    {
        name: 'recordCheckReport export',
        pattern: /(?:^|\n)\s*export\b[^\n;]*\brecordCheckReport\b|(?:^|\n)\s*export\s*\{[\s\S]*?\brecordCheckReport\b[\s\S]*?\}/,
    },
    {
        name: 'recordCheckReport const definition',
        pattern: /\bconst\s+recordCheckReport\s*=/,
    },
    {
        name: 'recordHealthReport function definition',
        pattern: /\bfunction\s+recordHealthReport\s*\(/,
    },
    {
        name: 'recordHealthReport export',
        pattern: /(?:^|\n)\s*export\b[^\n;]*\brecordHealthReport\b|(?:^|\n)\s*export\s*\{[\s\S]*?\brecordHealthReport\b[\s\S]*?\}/,
    },
    {
        name: 'recordHealthReport const definition',
        pattern: /\bconst\s+recordHealthReport\s*=/,
    },
]

function gitTrackedAndUnignoredFiles(): string[] {
    const output = runGitWorktreeCommand(['ls-files', '-co', '--exclude-standard'], REPO_ROOT, {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    return output
        .split('\n')
        .filter(Boolean)
        .filter(path => existsSync(join(REPO_ROOT, path)))
        .sort()
}

function isScannableSource(relativePath: string): boolean {
    if (!SOURCE_EXTENSIONS.some(extension => relativePath.endsWith(extension))) return false
    return !EXCLUDED_PREFIXES.some(prefix => relativePath.startsWith(prefix) || relativePath.includes(`/${prefix}`))
}

function expectedDefinitionFile(patternName: string): string {
    return patternName.startsWith('recordCheckReport')
        ? ALLOWED_DEFINITION_FILES.get('recordCheckReport')!
        : ALLOWED_DEFINITION_FILES.get('recordHealthReport')!
}

function isAllowedDefinition(relativePath: string, patternName: string): boolean {
    return relativePath === expectedDefinitionFile(patternName)
}

async function sourceOfTruthFindings(): Promise<SourceOfTruthFinding[]> {
    const findings: SourceOfTruthFinding[] = []
    const files = gitTrackedAndUnignoredFiles().filter(isScannableSource)

    await Promise.all(files.map(async file => {
        const source = await readFile(resolve(REPO_ROOT, file), 'utf8')
        for (const writerPattern of WRITER_DEFINITION_PATTERNS) {
            if (writerPattern.pattern.test(source) && !isAllowedDefinition(file, writerPattern.name)) {
                findings.push({file, pattern: writerPattern.name})
            }
        }
    }))

    return findings.sort((a, b) => `${a.file}:${a.pattern}`.localeCompare(`${b.file}:${b.pattern}`))
}

describe('source-of-truth guard', () => {
    it('keeps canonical metric and check report writer definitions in _shared', async () => {
        // The canonical metric/check report writers recordCheckReport and
        // recordHealthReport must be DEFINED only in packages/measures/src/_shared.
        // External consumers (Playwright reporters, vitest configs, future
        // consumers) may import and call them through @vt/measures package exports.
        // This guard prevents parallel writer definitions, not canonical consumption.
        const findings = await sourceOfTruthFindings()

        await recordHealthMetric({
            metricId: 'source-of-truth-guard',
            metricName: 'Source Of Truth Guard',
            description: 'Detects parallel report writer definitions outside packages/measures/src/_shared.',
            category: 'Other',
            current: findings.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {findings},
        })

        expect(
            findings.map(f => `${f.file}: ${f.pattern}`),
            `Parallel report writer definitions:\n${findings.map(f => `  ${f.file}: ${f.pattern}`).join('\n')}`,
        ).toEqual([])
    })
})
