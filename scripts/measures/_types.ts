// Type + helpers shared by every measure in this folder.
// Files starting with `_` are NOT loaded as measures by capture-ci-checks.mjs.

export type ParserKind = 'vitest' | 'playwright' | 'none'

export type MeasureCategory = 'Unit' | 'Integration' | 'E2E' | 'Lint' | 'TypeCheck' | 'Static' | 'Command' | 'Hook' | 'Other'

export type CheckDef = {
    readonly id: string
    readonly name: string
    readonly category: MeasureCategory
    readonly display: string
    readonly args: (jsonOut: string | null) => readonly string[]
    readonly parser: ParserKind
    readonly slow?: boolean
    readonly timeoutMs?: number
}

export const E2E_TIMEOUT_MS = 30 * 60 * 1000

export const npmRun = (name: string, extras: readonly string[] = []): string[] =>
    ['npm', 'run', name, ...(extras.length ? ['--', ...extras] : [])]

export const npmWorkspaceRun = (ws: string, name: string, extras: readonly string[] = []): string[] =>
    ['npm', '--workspace', ws, 'run', name, ...(extras.length ? ['--', ...extras] : [])]

export const npmWorkspaceExec = (ws: string, ...args: string[]): string[] =>
    ['npm', '--workspace', ws, 'exec', '--', ...args]

export const vitestJsonArgs = (jsonOut: string | null): string[] =>
    jsonOut === null ? ['--reporter=json'] : ['--reporter=json', `--outputFile=${jsonOut}`]

export const playwrightJsonArgs = (): string[] => ['--reporter=json']
