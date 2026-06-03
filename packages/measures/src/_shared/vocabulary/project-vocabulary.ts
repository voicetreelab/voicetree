import {readFile} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

import {listGitTrackedFiles} from '../discovery/git-tracked-files.ts'

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
// "voicetreeHomePath". Spelled split-then-joined so this guard module does not
// itself trip the guard (this module is also self-excluded from scanning, but
// the split keeps the legacy precedent intact).
const LEGACY_TERM = ['v', 'ault'].join('')
const LEGACY_HOME_TERM = ['app', 'Support'].join('')
const LEGACY_HOME_KEBAB_TERM = ['app', 'support'].join('-')
const LEGACY_HOME_ENV_TERM = ['APP', 'SUPPORT'].join('_')
const PATH_TERMS: readonly string[] = [
    LEGACY_TERM,
    `${LEGACY_TERM[0].toUpperCase()}${LEGACY_TERM.slice(1)}`,
    LEGACY_TERM.toUpperCase(),
    LEGACY_HOME_TERM,
    LEGACY_HOME_KEBAB_TERM,
    LEGACY_HOME_ENV_TERM,
]

// "mcp": VoiceTree migrated off being an MCP server to the `vt` CLI +
// vt-daemon `/rpc`, so "mcp" must not appear in VoiceTree-owned code. Only the
// three case forms the codebase actually uses are listed, so incidental
// mixed-case noise (e.g. base64 blobs containing "MCp") is not matched.
const MCP_TERMS: ReadonlySet<string> = new Set(['mcp', 'Mcp', 'MCP'])

const TERMS: readonly string[] = [...PATH_TERMS, ...MCP_TERMS]

// --- Allowances ------------------------------------------------------------
// The "mcp" purge ratchet. Each allowance is a legitimate remaining use; the
// set shrinks as cleanup proceeds (notably the planned vt-daemon `Mcp*` rename,
// documented under ~/brain/mem). New stray "mcp" (prose, a new identifier, a
// new file/package) is NOT covered and fails the gate.
//
// Two shapes:
//  - CONTEXT_ALLOWANCES suppress "mcp" wherever it sits inside the given
//    substring (used for cross-cutting identifiers and external-protocol
//    vocabulary that appear throughout the tree).
//  - PATH_ALLOWANCES suppress the "mcp" terms (only — `vault`/`appSupport`
//    stay enforced) inside a repo-relative file or directory prefix (used for
//    cohesive subsystems that are wholly MCP-named and slated for a later
//    purge pass or the planned rename).
//
// Categories:
//  - 'protocol'          : external MCP-ecosystem vocabulary VoiceTree must
//                          speak to configure agents / Playwright (permanent).
//  - 'stripper'          : the migration cleanup that strips stale VoiceTree
//                          entries from users' MCP client config (permanent).
//  - 'daemon-tool-layer' : the live vt-daemon `Mcp*` tool layer + its direct
//                          consumers, pending the rename (shrinks to zero).
//  - 'client-machinery'  : agent/test/perf machinery that drives the daemon
//                          and reads MCP client config; out of scope for the
//                          current purge, tracked for a later pass.
//  - 'suspected-dead'    : MCP-server-era scripts that appear to depend on the
//                          removed `/mcp` endpoint; allowed (not deleted)
//                          pending review — see the rename-plan node.
export type VocabularyAllowanceCategory =
    | 'protocol'
    | 'stripper'
    | 'daemon-tool-layer'
    | 'client-machinery'
    | 'suspected-dead'

export type ContextAllowance = {
    readonly context: string
    readonly category: VocabularyAllowanceCategory
    readonly reason: string
}

export type PathAllowance = {
    readonly pathPrefix: string
    readonly category: VocabularyAllowanceCategory
    readonly reason: string
}

export const CONTEXT_ALLOWANCES: readonly ContextAllowance[] = [
    // --- protocol (external MCP ecosystem) ---------------------------------
    {context: '.mcp.json', category: 'protocol', reason: 'MCP client config filename (Claude/Playwright agents)'},
    {context: 'mcpServers', category: 'protocol', reason: 'MCP client config schema key'},
    {context: 'mcp_servers', category: 'protocol', reason: 'MCP client config schema key (snake_case driver)'},
    {context: 'mcp__', category: 'protocol', reason: 'MCP tool-name namespacing convention (mcp__server__tool)'},
    {context: 'mcp_tool_call', category: 'protocol', reason: 'MCP tool-call event name (agent driver)'},
    {context: '@modelcontextprotocol', category: 'protocol', reason: 'MCP SDK package scope'},
    {context: '@playwright/mcp', category: 'protocol', reason: 'Playwright MCP package (third-party, powers playwright-debug)'},
    {context: 'voicetreelab/lazy-mcp', category: 'protocol', reason: 'external repo reference (a separate VoiceTree tool repo)'},
    {context: 'PLAYWRIGHT_MCP_CDP_ENDPOINT', category: 'protocol', reason: 'Playwright MCP CDP endpoint env var'},
    {context: 'Playwright MCP', category: 'protocol', reason: 'Playwright MCP prose in playwright-debug plugin/skill'},
    {context: 'enabledMcpjsonServers', category: 'protocol', reason: 'Claude Code agent config key enabling MCP servers'},

    // --- stripper (④ migration cleanup) ------------------------------------
    {context: 'stripStaleVoicetreeMcpEntries', category: 'stripper', reason: 'removes stale VoiceTree entries from users\' MCP config on open'},
    {context: 'stripStaleMcpEntries', category: 'stripper', reason: 'stale MCP entry stripper helper'},
    {context: 'stripFromMcpJsonShape', category: 'stripper', reason: 'stale MCP entry stripper helper'},
    {context: 'mcp-client-config', category: 'stripper', reason: 'module hosting the stale-entry stripper'},
    {context: 'VOICETREE_MCP_SERVER_NAME', category: 'stripper', reason: 'name of the stale VoiceTree entry the stripper removes'},

    // --- daemon-tool-layer: RENAME COMPLETE ① -------------------------------
    // The live vt-daemon `Mcp*` tool layer has been renamed to the Tool*/
    // getTool*/applyTool* family (McpToolResponse → ToolResponse,
    // getMcpGraph → getToolGraph, applyMcpGraphDelta → applyToolGraphDelta,
    // config/mcpBridges.ts → config/toolBridges.ts, …). No allowances remain
    // for it — the gate now enforces zero "mcp" across vt-daemon and its
    // cross-package consumers. The sole survivor is the persisted owner
    // identity (PATH_ALLOWANCES below), deferred as a wire/data-format change.

    // --- daemon-tool-layer: the one deferred survivor ----------------------
    // The persisted/runtime-compared owner+caller identity literal 'mcp'
    // (graph-db-protocol/owner.ts union+array, vtd.ts CALLER_KINDS). Renaming
    // it touches a value serialized to vtd.owner.json + exhaustive CallerKind
    // matches, so it is a separate follow-up. Scoped to the quoted literal so
    // only the identity value is exempt — stray prose "mcp"/"MCP" still fails.
    {context: '\'mcp\'', category: 'daemon-tool-layer', reason: 'persisted/runtime-compared owner+caller identity literal — deferred follow-up (needs vtd.owner.json migration + CallerKind audit)'},

    // --- client-machinery (scattered product/lib identifiers) --------------
    {context: 'mcpPort', category: 'client-machinery', reason: 'daemon port discovery field — later purge pass'},
    {context: 'McpClient', category: 'client-machinery', reason: 'daemon client wrapper — later purge pass'},
]

export const PATH_ALLOWANCES: readonly PathAllowance[] = [
    // ① the vt-daemon Mcp* tool-layer rename has LANDED — the package-wide
    // allowance is gone; vt-daemon is now gated at zero "mcp". The one
    // surviving reference (the persisted 'mcp' owner+caller identity literal)
    // is covered by the scoped CONTEXT_ALLOWANCE above, not a path allowance.

    // ④ MCP client-config bootstrap (the stale-entry stripper + agent discovery file writer).
    {pathPrefix: 'webapp/src/shell/edge/main/runtime/electron/startup/project-bootstrap/', category: 'stripper', reason: 'MCP client-config stripper + agent discovery bootstrap'},

    // ③ Playwright MCP CDP / .mcp.json worktree setup.
    {pathPrefix: 'scripts/git/worktree/', category: 'protocol', reason: 'Playwright MCP CDP + .mcp.json worktree provisioning'},

    // client/test/perf machinery that drives the daemon via MCP-named discovery
    // and spawn paths — out of scope for this purge, tracked for a later pass.
    {pathPrefix: 'tools/vt-fake-agent/', category: 'client-machinery', reason: 'fake-agent MCP test client harness'},
    {pathPrefix: 'packages/measures/perf/', category: 'client-machinery', reason: 'perf storm harness: MCP discovery/spawn machinery'},
    {pathPrefix: 'webapp/e2e-tests/', category: 'client-machinery', reason: 'Electron e2e tests exercising MCP-named spawn/discovery flows'},

    // OpenSpec change records: point-in-time proposals that accurately use the
    // vocabulary of their time and only mention "mcp" incidentally in prose.
    // Allowed pending an archive decision. (NOT a permanent home for "mcp".)
    {pathPrefix: 'openspec/changes/', category: 'suspected-dead', reason: 'OpenSpec change records — point-in-time proposals, pending archive decision'},
]

// The vocabulary gate's own module names every term it governs; exempt it from
// scanning (a dictionary of banned words cannot list itself).
const SELF_MODULE_DIR = 'packages/measures/src/_shared/vocabulary'

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

// Dependency lockfiles are generated and full of integrity hashes that match
// banned terms by coincidence (e.g. a sha512 containing "Mcp").
const EXCLUDED_FILE_NAMES: ReadonlySet<string> = new Set([
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
])

function isExcludedDir(name: string): boolean {
    return EXCLUDED_DIR_NAMES.has(name)
        || EXCLUDED_DIR_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isExcludedFile(name: string): boolean {
    return EXCLUDED_FILE_NAMES.has(name)
}

function isUnderPrefix(repoRelativePath: string, prefix: string): boolean {
    return repoRelativePath === prefix
        || repoRelativePath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
}

function isSelfModule(repoRelativePath: string): boolean {
    return isUnderPrefix(repoRelativePath, SELF_MODULE_DIR)
}

function isMcpPathAllowed(repoRelativePath: string): boolean {
    return PATH_ALLOWANCES.some(allowance => isUnderPrefix(repoRelativePath, allowance.pathPrefix))
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

// All [start, end) ranges in `text` covered by a context allowance.
function allowedSpans(text: string): readonly Span[] {
    const spans: Span[] = []
    for (const {context} of CONTEXT_ALLOWANCES) {
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

function isWithinAllowedSpan(spans: readonly Span[], start: number, end: number): boolean {
    return spans.some(span => span.start <= start && end <= span.end)
}

// An inline directive lets a file opt a single term out of the check when it must
// reference an external system that owns that word (its config keys, API surface,
// etc.). Format: `<directive> <term> — <reason>`. The exemption is scoped to the
// file that declares it and to the exact term named — every other term and every
// other file stays enforced, and the required reason documents the exception where
// it is used rather than in a distant allowlist.
//
// (Ported verbatim from `fix/obsidian-config-vaults-key`@7649b3e60 so the two
// branches merge to an identical primitive; here it composes with the CONTEXT_
// and PATH_ALLOWANCES below — see disallowedMatches.)
const ALLOW_DIRECTIVE = 'project-vocabulary:allow'

const NO_ALLOWED_TERMS: ReadonlySet<string> = new Set()

function allowedTerms(content: string): ReadonlySet<string> {
    const allowed = new Set<string>()
    for (const term of TERMS) {
        if (content.includes(`${ALLOW_DIRECTIVE} ${term}`)) allowed.add(term)
    }
    return allowed
}

type TermMatch = {readonly term: string; readonly index: number}

// Every banned-term occurrence in `text` not covered by ANY exemption, ordered
// by position so cleanup output is deterministic. The three exemptions compose
// orthogonally — a term occurrence is allowed iff:
//   1. an inline `project-vocabulary:allow <term>` directive exempts it for this
//      file (`directiveAllowed`; content only — paths cannot carry a directive), OR
//   2. it sits inside a CONTEXT_ALLOWANCE span, OR
//   3. it is an mcp term AND the file is under a PATH_ALLOWANCE (`mcpPathAllowed`).
// `vault`/`appSupport` are never path-allowed, so (3) only ever relaxes "mcp".
function disallowedMatches(
    text: string,
    mcpPathAllowed: boolean,
    directiveAllowed: ReadonlySet<string>,
): readonly TermMatch[] {
    const spans = allowedSpans(text)
    const matches: TermMatch[] = []
    for (const term of TERMS) {
        if (directiveAllowed.has(term)) continue
        if (mcpPathAllowed && MCP_TERMS.has(term)) continue
        let from = 0
        for (;;) {
            const index = text.indexOf(term, from)
            if (index === -1) break
            if (!isWithinAllowedSpan(spans, index, index + term.length)) {
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
        'to CONTEXT_ALLOWANCES or PATH_ALLOWANCES in project-vocabulary.ts with a rationale.',
        ...details,
        ...overflow,
        '',
    ].join('\n')
}

async function scanFile(repoRoot: string, absolutePath: string): Promise<readonly ProjectVocabularyViolation[]> {
    const repoRelativePath = toRepoPath(repoRoot, absolutePath)
    if (isSelfModule(repoRelativePath)) return []
    const mcpPathAllowed = isMcpPathAllowed(repoRelativePath)

    // Paths cannot carry an inline directive, so no term is directive-exempt for the path check.
    const pathViolations: ProjectVocabularyViolation[] = disallowedMatches(repoRelativePath, mcpPathAllowed, NO_ALLOWED_TERMS).map(match => ({
        path: repoRelativePath,
        line: null,
        column: null,
        source: 'path' as const,
        term: match.term,
    }))

    if (!shouldReadContent(repoRelativePath)) return pathViolations

    const content = await readFile(absolutePath, 'utf8').catch(() => null)
    if (content === null) return pathViolations
    const contentViolations: ProjectVocabularyViolation[] = disallowedMatches(content, mcpPathAllowed, allowedTerms(content)).map(match => {
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

// A git-tracked path is excluded when any directory segment is an excluded dir
// (by exact name or prefix — e.g. `playwright-report-*`) or its filename is an
// excluded file (dependency lockfiles, whose integrity hashes coincidentally
// contain banned terms). Build/cache dirs are untracked by construction, so the
// tracked enumeration in checkProjectVocabulary needs no other path filter.
function isExcludedTrackedPath(repoRelativePath: string): boolean {
    const segments = repoRelativePath.split('/')
    const fileName = segments[segments.length - 1]
    const dirSegments = segments.slice(0, -1)
    return dirSegments.some(isExcludedDir) || isExcludedFile(fileName)
}

export async function checkProjectVocabulary(repoRoot: string): Promise<ProjectVocabularyReport> {
    // Enumerate git-tracked files only. A filesystem walk sweeps up untracked
    // caches (`.ck/`), generated fixtures, and `.gitignore`d output — none of
    // which are the committed codebase the vocabulary policy governs. Tracked
    // enumeration leaves only the archived/report-dir denylist and lockfile
    // filter (build/cache dirs are untracked by construction).
    const trackedPaths = listGitTrackedFiles(repoRoot)
        .filter(repoRelativePath => !isExcludedTrackedPath(repoRelativePath))
    const perFile = await Promise.all(
        trackedPaths.map(repoRelativePath => scanFile(repoRoot, join(repoRoot, repoRelativePath))),
    )
    const violations = perFile.flat()
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
