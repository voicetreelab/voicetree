import {readdir, readFile} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

export type ProjectVocabularyViolation = {
    readonly path: string
    readonly line: number | null
    readonly column: number | null
    readonly source: 'path' | 'content'
    readonly term: string
}

export type ProjectVocabularyReport = {
    readonly violations: readonly ProjectVocabularyViolation[]
    readonly report: string
}

const LEGACY_TERM = ['v', 'ault'].join('')
const LEGACY_HOME_TERM = ['app', 'Support'].join('')
const LEGACY_HOME_KEBAB_TERM = ['app', 'support'].join('-')
const LEGACY_HOME_ENV_TERM = ['APP', 'SUPPORT'].join('_')
const TERMS: readonly string[] = [
    LEGACY_TERM,
    `${LEGACY_TERM[0].toUpperCase()}${LEGACY_TERM.slice(1)}`,
    LEGACY_TERM.toUpperCase(),
    LEGACY_HOME_TERM,
    LEGACY_HOME_KEBAB_TERM,
    LEGACY_HOME_ENV_TERM,
]

const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
    '.git',
    'node_modules',
    'dist',
    'dist-electron',
    'dist-test',
    'build',
    'out',
    'coverage',
    'playwright-report',
    'playwright-report-api',
    'test-results',
    'health-dashboard',
    'voicetree-20-5',
    'voicetree-22-5',
])

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
    '',
    '.cjs',
    '.css',
    '.csv',
    '.html',
    '.js',
    '.json',
    '.jsonc',
    '.jsx',
    '.md',
    '.mjs',
    '.py',
    '.sh',
    '.sql',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.yaml',
    '.yml',
])

function extension(path: string): string {
    const lastSlash = path.lastIndexOf('/')
    const lastDot = path.lastIndexOf('.')
    if (lastDot <= lastSlash) return ''
    return path.slice(lastDot)
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
    return relative(repoRoot, absolutePath).split(sep).join('/')
}

function shouldReadContent(repoRelativePath: string): boolean {
    return TEXT_EXTENSIONS.has(extension(repoRelativePath))
}

function matchTerm(text: string): {readonly term: string; readonly index: number} | null {
    for (const term of TERMS) {
        const index = text.indexOf(term)
        if (index !== -1) return {term, index}
    }
    return null
}

function lineColumn(content: string, index: number): {readonly line: number; readonly column: number} {
    const before = content.slice(0, index)
    const lines = before.split('\n')
    return {
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
    }
}

function formatViolations(violations: readonly ProjectVocabularyViolation[]): string {
    if (violations.length === 0) return ''
    const details = violations
        .slice(0, 80)
        .map(violation => {
            const location = violation.line === null
                ? violation.path
                : `${violation.path}:${violation.line}:${violation.column}`
            return `  - ${location} (${violation.source}: ${violation.term})`
        })
    const overflow = violations.length > details.length
        ? [`  ... ${violations.length - details.length} more`]
        : []
    return [
        `Project vocabulary drift: found ${violations.length} legacy project-path term(s).`,
        'Use "project" for root paths, "writeFolderPath" for write targets, and "voicetreeHomePath" for global state.',
        ...details,
        ...overflow,
        '',
    ].join('\n')
}

async function scanFile(repoRoot: string, absolutePath: string): Promise<readonly ProjectVocabularyViolation[]> {
    const repoRelativePath = toRepoPath(repoRoot, absolutePath)
    const pathMatch = matchTerm(repoRelativePath)
    const pathViolations: ProjectVocabularyViolation[] = pathMatch === null
        ? []
        : [{
            path: repoRelativePath,
            line: null,
            column: null,
            source: 'path',
            term: pathMatch.term,
        }]

    if (!shouldReadContent(repoRelativePath)) return pathViolations

    const content = await readFile(absolutePath, 'utf8').catch(() => null)
    if (content === null) return pathViolations
    const contentMatch = matchTerm(content)
    if (contentMatch === null) return pathViolations
    const location = lineColumn(content, contentMatch.index)
    return [
        ...pathViolations,
        {
            path: repoRelativePath,
            line: location.line,
            column: location.column,
            source: 'content',
            term: contentMatch.term,
        },
    ]
}

async function scanDirectory(repoRoot: string, absoluteDir: string): Promise<readonly ProjectVocabularyViolation[]> {
    const entries = await readdir(absoluteDir, {withFileTypes: true})
    const violations: ProjectVocabularyViolation[] = []
    for (const entry of entries) {
        if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue
        const absolutePath = join(absoluteDir, entry.name)
        if (entry.isDirectory()) {
            violations.push(...await scanDirectory(repoRoot, absolutePath))
        } else if (entry.isFile()) {
            violations.push(...await scanFile(repoRoot, absolutePath))
        }
    }
    return violations
}

export async function checkProjectVocabulary(repoRoot: string): Promise<ProjectVocabularyReport> {
    const violations = await scanDirectory(repoRoot, repoRoot)
    const sorted = [...violations].sort((a, b) =>
        a.path.localeCompare(b.path)
        || (a.line ?? 0) - (b.line ?? 0)
        || a.source.localeCompare(b.source),
    )
    return {
        violations: sorted,
        report: formatViolations(sorted),
    }
}
