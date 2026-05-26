// Pure policy for the "directory fanout" shape rule: a source directory
// holding more than MAX_DIRECTORY_CHILDREN immediate children has stopped
// being a coherent module and should be split into subfolders.
//
// No I/O here — callers (the tier-0 runner and the systems-health shape
// test) read the filesystem themselves and feed the resulting fanouts in.
// Keeping this module pure means `measures/_shared` does not need to grow
// fs/path-io implicit-global dependencies just to enforce the rule.

// Hard design limit set 2026-05-15: a directory with more than 15 children
// is a signal it has stopped being a coherent module and should be split.
export const MAX_DIRECTORY_CHILDREN: number = 15

export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'build',
    'coverage',
    'dist',
    'node_modules',
])

export type DirectoryFanout = {
    readonly directory: string
    readonly childCount: number
    readonly children: readonly string[]
}

export function findFanoutViolations(fanouts: readonly DirectoryFanout[]): DirectoryFanout[] {
    return fanouts
        .filter(fanout => fanout.childCount > MAX_DIRECTORY_CHILDREN)
        .sort((a, b) => b.childCount - a.childCount || a.directory.localeCompare(b.directory))
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
    '',
].join('\n')

function formatViolation(violation: DirectoryFanout): string {
    return [
        `${violation.directory}: ${violation.childCount} children`,
        `  ${violation.children.join(', ')}`,
    ].join('\n')
}

export function formatFanoutReport(violations: readonly DirectoryFanout[]): string {
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
