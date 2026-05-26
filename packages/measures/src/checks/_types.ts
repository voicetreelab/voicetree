// Type + helpers shared by every measure in this folder.
// Files starting with `_` are NOT loaded as measures by capture-ci-checks.ts,
// except the suite-level `health/_all.check.ts`.

type ParserKind = 'vitest' | 'playwright' | 'none'

type MeasureCategory = 'Unit' | 'Integration' | 'E2E' | 'Lint' | 'TypeCheck' | 'Static' | 'Command' | 'Hook' | 'Other'

export type CheckDef = {
    readonly id: string
    readonly name: string
    readonly category: MeasureCategory
    readonly display: string
    readonly args: (jsonOut: string | null) => readonly string[]
    readonly parser: ParserKind
    readonly phase?: 'parallel' | 'isolated'
    readonly timeoutMs?: number
    readonly exclusive?: boolean
}

const e2eTimeoutMs = 30 * 60 * 1000

// Stryker on a full package routinely needs 30–90 minutes. Mutation testing
// gets its own budget so the e2e ceiling doesn't silently terminate it.
const mutationTimeoutMs = 2 * 60 * 60 * 1000

const npmRun = (name: string, extras: readonly string[] = []): string[] =>
    ['npm', 'run', name, ...(extras.length ? ['--', ...extras] : [])]

const npmExec = (...args: string[]): string[] =>
    ['npm', 'exec', '--', ...args]

const npmWorkspaceRun = (ws: string, name: string, extras: readonly string[] = []): string[] =>
    ['npm', '--workspace', ws, 'run', name, ...(extras.length ? ['--', ...extras] : [])]

const npmWorkspaceExec = (ws: string, ...args: string[]): string[] =>
    ['npm', '--workspace', ws, 'exec', '--', ...args]

const vitestJsonArgs = (jsonOut: string | null): string[] =>
    jsonOut === null ? ['--reporter=json'] : ['--reporter=json', `--outputFile=${jsonOut}`]

const playwrightJsonArgs = (): string[] => ['--reporter=json']

export const checkArgs = {
    e2eTimeoutMs,
    mutationTimeoutMs,
    npmRun,
    npmExec,
    npmWorkspaceRun,
    npmWorkspaceExec,
    vitestJsonArgs,
    playwrightJsonArgs,
} as const
