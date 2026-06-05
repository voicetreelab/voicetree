// Policy + scanner + formatter for the "directory fanout" shape rule:
// a source directory holding more than MAX_DIRECTORY_CHILDREN immediate
// children has stopped being a coherent module and should be split.
//
// Exposes ONE deep function (`checkDirectoryFanouts`) so callers — the
// tier-0 runner and the systems-health shape test — pull a single symbol
// across the community boundary instead of fanning out across a policy
// constant + types + helpers cluster.

import {DEFAULT_REPO_ROOT, discoverPackages} from '../discovery/discover-packages.ts'
import {walkDirectories} from '../walk-directories.ts'

const SKILL_DOC = '~/brain/workflows/engineering/architectural-complexity/fp-rearchitecting/address_measures/address-directory-fanout.md'

// Hard design limit set 2026-05-15: a directory with more than 15 children
// has stopped being a coherent module and should be split.
const MAX_DIRECTORY_CHILDREN: number = 15

const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'build',
    'coverage',
    'dist',
    'node_modules',
])

type Fanout = {
    readonly directory: string
    readonly childCount: number
    readonly children: readonly string[]
}

type DirectoryFanoutReport = {
    readonly maxChildCount: number
    readonly maxAllowedChildCount: number
    readonly topDirectories: readonly Fanout[]
    readonly violations: readonly Fanout[]
    readonly report: string
}

export async function checkDirectoryFanouts(
    opts: {
        readonly roots?: readonly string[]
        readonly repoRoot?: string
        readonly walker?: typeof walkDirectories
    } = {},
): Promise<DirectoryFanoutReport> {
    const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
    const walker = opts.walker ?? walkDirectories
    const roots = opts.roots ?? (await discoverPackages(repoRoot)).map(pkg => pkg.srcRoot).sort()
    const fanouts = (await Promise.all(roots.map(root => scanFanouts(root, repoRoot, walker)))).flat()
    const sorted = fanouts.slice().sort((a, b) =>
        b.childCount - a.childCount || a.directory.localeCompare(b.directory),
    )
    const violations = sorted.filter(f => f.childCount > MAX_DIRECTORY_CHILDREN)
    const maxChildCount = fanouts.reduce((m, f) => Math.max(m, f.childCount), 0)
    return {
        maxChildCount,
        maxAllowedChildCount: MAX_DIRECTORY_CHILDREN,
        topDirectories: sorted.slice(0, 20),
        violations,
        report: formatReport(violations),
    }
}

async function scanFanouts(
    root: string,
    repoRoot: string,
    walker: typeof walkDirectories,
): Promise<Fanout[]> {
    const walked = await walker(root, {
        includeEntry: entry => !(entry.kind === 'directory' && IGNORED_DIRECTORY_NAMES.has(entry.name)),
    })
    return walked.map(directory => ({
        directory: directory.absolutePath.slice(repoRoot.length + 1),
        childCount: directory.entries.length,
        children: directory.entries.map(entry => entry.name),
    }))
}

const BAR = '━'.repeat(80)

const REMEDIATION: string = [
    '',
    'Remediation:',
    `  A source directory holding more than ${MAX_DIRECTORY_CHILDREN} immediate children`,
    '  has stopped being a coherent module. Reorganise the listed directories',
    '  into a folder hierarchy that reflects the semantic / code structure',
    '  (e.g. group lifecycle files under `lifecycle/`, HTTP wiring under',
    '  `server/`, state files under `state/`). Update relative imports',
    '  accordingly. Do NOT raise the limit — that would be reward-hacking',
    '  this gate.',
    `\nSee: ${SKILL_DOC}`,
].join('\n')

function formatViolation(violation: Fanout): string {
    return [
        `${violation.directory}: ${violation.childCount} children`,
        `  ${violation.children.join(', ')}`,
    ].join('\n')
}

function formatReport(violations: readonly Fanout[]): string {
    if (violations.length === 0) return ''
    const body = violations.map(formatViolation).join('\n\n')
    const subject = violations.length === 1
        ? '1 source directory has'
        : `${violations.length} source directories have`
    return [
        '',
        BAR,
        `Refused: ${subject} exceeded the ${MAX_DIRECTORY_CHILDREN}-child fanout limit.`,
        '',
        body,
        REMEDIATION,
        BAR,
        '',
    ].join('\n')
}
