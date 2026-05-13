import {open, readdir, readFile, rename, unlink, writeFile, mkdir} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')
const REPORTS_DIR: string = join(REPO_ROOT, 'health-dashboard', 'reports')
const CHECKS_DIR: string = join(REPORTS_DIR, 'checks')
const CHECKS_REPORT_PATH: string = join(REPORTS_DIR, 'checks.json')
const CHECKS_LOCK_PATH: string = join(REPORTS_DIR, 'checks.json.lock')
const CHECK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LOCK_TIMEOUT_MS = 5_000

const CATEGORIES = ['Unit', 'Integration', 'E2E', 'Lint', 'TypeCheck', 'Static', 'Command', 'Hook', 'Other'] as const
const STATUSES = ['pass', 'fail', 'skip'] as const

export type CheckReport = {
    readonly checkId: string
    readonly checkName: string
    readonly category: typeof CATEGORIES[number]
    readonly command: string
    readonly status: typeof STATUSES[number]
    readonly durationMs: number
    readonly testsTotal?: number
    readonly testsPassed?: number
    readonly testsFailed?: number
    readonly testsSkipped?: number
    readonly slow?: boolean
    readonly errorSummary?: string
    readonly timestamp: string
    readonly details?: Record<string, unknown>
}

type ChecksReport = {
    readonly generatedAt: string
    readonly reports: readonly CheckReport[]
}

function checkReportPath(checkId: string): string {
    return join(CHECKS_DIR, `${checkId}.json`)
}

function assertCheckReport(report: CheckReport): void {
    if (!CHECK_ID_PATTERN.test(report.checkId)) throw new Error(`checkId must be kebab-case: ${report.checkId}`)
    if (!report.checkName.trim()) throw new Error(`checkName is required for ${report.checkId}`)
    if (!CATEGORIES.includes(report.category)) throw new Error(`unsupported category for ${report.checkId}: ${report.category}`)
    if (!report.command.trim()) throw new Error(`command is required for ${report.checkId}`)
    if (!STATUSES.includes(report.status)) throw new Error(`unsupported status for ${report.checkId}: ${report.status}`)
    if (!Number.isFinite(report.durationMs) || report.durationMs < 0) throw new Error(`durationMs must be a non-negative finite number for ${report.checkId}`)
    if (Number.isNaN(Date.parse(report.timestamp))) throw new Error(`timestamp must be ISO-like for ${report.checkId}: ${report.timestamp}`)
    for (const [field, value] of [
        ['testsTotal', report.testsTotal],
        ['testsPassed', report.testsPassed],
        ['testsFailed', report.testsFailed],
        ['testsSkipped', report.testsSkipped],
    ] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${field} must be a non-negative finite number for ${report.checkId}`)
    }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
        await rename(tmp, path)
    } catch (err) {
        await unlink(tmp).catch(() => {})
        throw err
    }
}

async function acquireLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    while (Date.now() < deadline) {
        try {
            return await open(path, 'wx')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
            await new Promise(resolve => setTimeout(resolve, 25))
        }
    }
    throw new Error(`timed out waiting for checks lock: ${path}`)
}

async function withChecksLock<T>(fn: () => Promise<T>): Promise<T> {
    const handle = await acquireLock(CHECKS_LOCK_PATH)
    try {
        return await fn()
    } finally {
        await handle.close().catch(() => {})
        await unlink(CHECKS_LOCK_PATH).catch(() => {})
    }
}

function isCheckReportFile(name: string): boolean {
    return name.endsWith('.json') && CHECK_ID_PATTERN.test(name.slice(0, -'.json'.length))
}

async function readCheckReport(path: string): Promise<CheckReport | null> {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as CheckReport
        assertCheckReport(parsed)
        return parsed
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

async function readAllCheckReports(): Promise<CheckReport[]> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
        entries = await readdir(CHECKS_DIR, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const reports = await Promise.all(entries
        .filter(entry => entry.isFile() && isCheckReportFile(entry.name))
        .map(entry => readCheckReport(join(CHECKS_DIR, entry.name))))

    return reports
        .filter((report): report is CheckReport => report !== null)
        .sort((a, b) => `${a.category}:${a.checkName}:${a.checkId}`.localeCompare(`${b.category}:${b.checkName}:${b.checkId}`))
}

async function writeChecksAggregate(): Promise<void> {
    const aggregate: ChecksReport = {
        generatedAt: new Date().toISOString(),
        reports: await readAllCheckReports(),
    }
    await writeJsonAtomic(CHECKS_REPORT_PATH, aggregate)
}

export async function recordCheckReport(report: CheckReport): Promise<void> {
    assertCheckReport(report)
    await mkdir(CHECKS_DIR, {recursive: true})
    await writeJsonAtomic(checkReportPath(report.checkId), report)
    await withChecksLock(writeChecksAggregate)
}
