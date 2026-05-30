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

// --- Banned terms ----------------------------------------------------------
// Legacy project-path vocabulary: replaced by "project" / "writeFolderPath" /
// "voicetreeHomePath". Spelled split-then-joined so this guard file does not
// itself trip the guard.
const LEGACY_TERM = ['v', 'ault'].join('')
const LEGACY_HOME_TERM = ['app', 'Support'].join('')
const LEGACY_HOME_KEBAB_TERM = ['app', 'support'].join('-')
const LEGACY_HOME_ENV_TERM = ['APP', 'SUPPORT'].join('_')

// "mcp": VoiceTree migrated off being an MCP server to the `vt` CLI +
// vt-daemon `/rpc`, so "mcp" must not appear in VoiceTree-owned code. The
// case variants below are the only ones the codebase actually uses
// (`mcp`, `Mcp`, `MCP`); listing them explicitly avoids matching incidental
// mixed-case noise (e.g. base64 blobs containing "MCp"). Legitimate remaining
// uses are enumerated in ALLOWANCES below.
const MCP_TERMS: readonly string[] = ['mcp', 'Mcp', 'MCP']

const TERMS: readonly string[] = [
    LEGACY_TERM,
    `${LEGACY_TERM[0].toUpperCase()}${LEGACY_TERM.slice(1)}`,
    LEGACY_TERM.toUpperCase(),
    LEGACY_HOME_TERM,
    LEGACY_HOME_KEBAB_TERM,
    LEGACY_HOME_ENV_TERM,
    ...MCP_TERMS,
]

// --- Allowances ------------------------------------------------------------
// A banned term is suppressed where it sits inside one of these context
// substrings. This is the "mcp" purge ratchet: each entry is a legitimate
// remaining use, and the list shrinks as cleanup proceeds. New stray "mcp"
// usages (prose, new identifiers) are NOT covered and fail the gate.
//
// Categories:
//  - 'protocol'  : external MCP-ecosystem vocabulary VoiceTree must speak to
//                  configure agents / Playwright (permanent).
//  - 'stripper'  : the migration cleanup that strips stale VoiceTree entries
//                  from users' MCP client config on open (permanent).
//  - 'daemon-tool-layer' : the live vt-daemon `Mcp*` tool layer, pending the
//                  rename planned under ~/brain/mem (shrinks to zero on rename).
//  - 'client-machinery'  : agent/test/perf machinery that drives the daemon
//                  and reads MCP client config; out of scope for the current
//                  purge, tracked for a later pass.
export type VocabularyAllowanceCategory =
    | 'protocol'
    | 'stripper'
    | 'daemon-tool-layer'
    | 'client-machinery'

export type VocabularyAllowance = {
    readonly context: string
    readonly category: VocabularyAllowanceCategory
    readonly reason: string
}

export const ALLOWANCES: readonly VocabularyAllowance[] = [
    // --- protocol (external MCP ecosystem) ---------------------------------
    {context: '.mcp.json', category: 'protocol', reason: 'MCP client config filename (Claude/Playwright agents)'},
    {context: 'mcpServers', category: 'protocol', reason: 'MCP client config schema key'},
    {context: 'mcp_servers', category: 'protocol', reason: 'MCP client config schema key (snake_case driver)'},
    {context: 'mcp__', category: 'protocol', reason: 'MCP tool-name namespacing convention (mcp__server__tool)'},
    {context: '@modelcontextprotocol', category: 'protocol', reason: 'MCP SDK package scope'},
    {context: '@playwright/mcp', category: 'protocol', reason: 'Playwright MCP package (third-party, powers playwright-debug)'},
    {context: 'PLAYWRIGHT_MCP_CDP_ENDPOINT', category: 'protocol', reason: 'Playwright MCP CDP endpoint env var'},
    {context: 'Playwright MCP', category: 'protocol', reason: 'Playwright MCP prose in playwright-debug plugin/skill'},
    {context: 'enabledMcpjsonServers', category: 'protocol', reason: 'Claude Code agent config key enabling MCP servers'},

    // --- stripper (④ migration cleanup) ------------------------------------
    {context: 'stripStaleVoicetreeMcpEntries', category: 'stripper', reason: 'removes stale VoiceTree entries from users\' MCP config on open'},
    {context: 'stripStaleMcpEntries', category: 'stripper', reason: 'stale MCP entry stripper helper'},
    {context: 'stripFromMcpJsonShape', category: 'stripper', reason: 'stale MCP entry stripper helper'},
    {context: 'mcp-client-config', category: 'stripper', reason: 'module hosting the stale-entry stripper'},
    {context: 'VOICETREE_MCP_SERVER_NAME', category: 'stripper', reason: 'name of the stale VoiceTree entry the stripper removes'},

    // --- daemon-tool-layer (① pending rename) ------------------------------
    {context: 'McpToolResponse', category: 'daemon-tool-layer', reason: 'live vt-daemon tool response type — rename planned'},
    {context: 'McpToolBridges', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge type — rename planned'},
    {context: 'McpToolResult', category: 'daemon-tool-layer', reason: 'live vt-daemon tool result type — rename planned'},
    {context: 'mcpBridges', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge module — rename planned'},
    {context: 'getMcpGraph', category: 'daemon-tool-layer', reason: 'live vt-daemon graph bridge accessor — rename planned'},
    {context: 'getMcpProjectPaths', category: 'daemon-tool-layer', reason: 'live vt-daemon bridge accessor — rename planned'},
    {context: 'getMcpProjectRoot', category: 'daemon-tool-layer', reason: 'live vt-daemon bridge accessor — rename planned'},
    {context: 'getMcpWriteFolderPath', category: 'daemon-tool-layer', reason: 'live vt-daemon bridge accessor — rename planned'},
    {context: 'getMcpWritePath', category: 'daemon-tool-layer', reason: 'live vt-daemon bridge accessor — rename planned'},
    {context: 'getMcpUnseenNodesAroundContextNode', category: 'daemon-tool-layer', reason: 'live vt-daemon bridge accessor — rename planned'},
    {context: 'configureMcpServer', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge configurator — rename planned'},
    {context: 'configureHeadlessMcpBridges', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge configurator — rename planned'},
    {context: 'buildDisabledMcpBridges', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge builder — rename planned'},
    {context: 'disabledMcpBridges', category: 'daemon-tool-layer', reason: 'live vt-daemon tool bridge fixture — rename planned'},
    {context: 'applyMcpGraphDelta', category: 'daemon-tool-layer', reason: 'live vt-daemon graph-delta applier — rename planned'},
    {context: 'addProgressNodeMcp', category: 'daemon-tool-layer', reason: 'live vt-daemon create-graph integration test — rename planned'},
    {context: 'mcp-graph-bridge', category: 'daemon-tool-layer', reason: 'live vt-daemon graph bridge module — rename planned'},
    {context: 'mcp-config', category: 'daemon-tool-layer', reason: 'live vt-daemon tool config module — rename planned'},
]

const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
    '.git',
    '.voicetree',
    'node_modules',
    'dist',
    'dist-electron',
    'dist-test',
    'build',
    'out',
    'coverage',
    'test-results',
    'health-dashboard',
    'voicetree-20-5',
    'voicetree-22-5',
])

// Generated Playwright HTML reports embed minified/base64 payloads that match
// banned terms by coincidence. They are build artifacts, not source.
const EXCLUDED_DIR_PREFIXES: readonly string[] = ['playwright-report']

function isExcludedDir(name: string): boolean {
    return EXCLUDED_DIR_NAMES.has(name)
        || EXCLUDED_DIR_PREFIXES.some(prefix => name.startsWith(prefix))
}

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

type Span = {readonly start: number; readonly end: number}

// All [start, end) ranges in `text` covered by an allowance context.
function allowedSpans(text: string): readonly Span[] {
    const spans: Span[] = []
    for (const {context} of ALLOWANCES) {
        let from = 0
        for (;;) {
            const index = text.indexOf(context, from)
            if (index === -1) break
            spans.push({start: index, end: index + context.length})
            from = index + 1
        }
    }
    return spans
}

function isAllowed(spans: readonly Span[], start: number, end: number): boolean {
    return spans.some(span => span.start <= start && end <= span.end)
}

type TermMatch = {readonly term: string; readonly index: number}

// Every banned-term occurrence in `text` not covered by an allowance, ordered
// by position so cleanup output is deterministic.
function disallowedMatches(text: string): readonly TermMatch[] {
    const spans = allowedSpans(text)
    const matches: TermMatch[] = []
    for (const term of TERMS) {
        let from = 0
        for (;;) {
            const index = text.indexOf(term, from)
            if (index === -1) break
            if (!isAllowed(spans, index, index + term.length)) {
                matches.push({term, index})
            }
            from = index + 1
        }
    }
    return [...matches].sort((a, b) => a.index - b.index || a.term.localeCompare(b.term))
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
        .slice(0, 120)
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
        `Project vocabulary drift: found ${violations.length} banned term(s).`,
        'Path terms: use "project" for root paths, "writeFolderPath" for write targets, "voicetreeHomePath" for global state.',
        '"mcp": VoiceTree no longer is an MCP server — use the vt CLI / vt-daemon /rpc vocabulary. A genuinely',
        'legitimate use (external MCP ecosystem, the stale-entry stripper, the pending daemon rename) must be added',
        'to ALLOWANCES in project-vocabulary.ts with a rationale.',
        ...details,
        ...overflow,
        '',
    ].join('\n')
}

async function scanFile(repoRoot: string, absolutePath: string): Promise<readonly ProjectVocabularyViolation[]> {
    const repoRelativePath = toRepoPath(repoRoot, absolutePath)
    const pathViolations: ProjectVocabularyViolation[] = disallowedMatches(repoRelativePath).map(match => ({
        path: repoRelativePath,
        line: null,
        column: null,
        source: 'path' as const,
        term: match.term,
    }))

    if (!shouldReadContent(repoRelativePath)) return pathViolations

    const content = await readFile(absolutePath, 'utf8').catch(() => null)
    if (content === null) return pathViolations
    const contentViolations: ProjectVocabularyViolation[] = disallowedMatches(content).map(match => {
        const location = lineColumn(content, match.index)
        return {
            path: repoRelativePath,
            line: location.line,
            column: location.column,
            source: 'content' as const,
            term: match.term,
        }
    })
    return [...pathViolations, ...contentViolations]
}

async function scanDirectory(repoRoot: string, absoluteDir: string): Promise<readonly ProjectVocabularyViolation[]> {
    const entries = await readdir(absoluteDir, {withFileTypes: true})
    const violations: ProjectVocabularyViolation[] = []
    for (const entry of entries) {
        if (entry.isDirectory() && isExcludedDir(entry.name)) continue
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
