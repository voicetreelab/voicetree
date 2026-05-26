import {readdir, readFile, rename, unlink, writeFile, mkdir} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {appendScore} from './scores-history-writer.ts'

const CI_REPORTING_SRC_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(CI_REPORTING_SRC_ROOT, '..', '..', '..', '..', '..')
const REPORTS_DIR: string = join(REPO_ROOT, 'health-dashboard', 'reports')
const CHECKS_DIR: string = join(REPORTS_DIR, 'checks')
const CHECKS_REPORT_PATH: string = join(REPORTS_DIR, 'checks.json')
const CHECK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const CATEGORIES = ['Unit', 'Integration', 'E2E', 'Lint', 'TypeCheck', 'Static', 'Command', 'Hook', 'Other'] as const
const STATUSES = ['pass', 'fail', 'skip'] as const

export type CheckReport = {
    readonly checkId: string
    readonly checkName: string
    readonly category: typeof CATEGORIES[number]
    readonly command: string
    readonly status: typeof STATUSES[number]
    readonly durationMs: number
    readonly startedAt: string
    readonly endedAt: string
    readonly testsTotal?: number
    readonly testsPassed?: number
    readonly testsFailed?: number
    readonly testsSkipped?: number
    readonly errorSummary?: string
    readonly timestamp: string
    readonly details?: Record<string, unknown>
}

type ChecksReport = {
    readonly generatedAt: string
    readonly reports: readonly CheckReport[]
}

type CheckReportCandidate = Partial<CheckReport> & Record<string, unknown>

function checkReportPath(checkId: string): string {
    return join(CHECKS_DIR, `${checkId}.json`)
}

function normalizeLegacyTimingFields(report: CheckReportCandidate): CheckReportCandidate {
    const timestamp = typeof report.timestamp === 'string' ? report.timestamp : undefined
    const durationMs = typeof report.durationMs === 'number' && Number.isFinite(report.durationMs)
        ? Math.max(0, report.durationMs)
        : 0
    const endedAt = typeof report.endedAt === 'string' ? report.endedAt : timestamp
    const endedAtMs = endedAt === undefined ? NaN : Date.parse(endedAt)
    const startedAt = typeof report.startedAt === 'string'
        ? report.startedAt
        : Number.isNaN(endedAtMs)
            ? undefined
            : new Date(endedAtMs - durationMs).toISOString()

    return {...report, startedAt, endedAt}
}

function assertCheckReport(report: CheckReport): void {
    if (!CHECK_ID_PATTERN.test(report.checkId)) throw new Error(`checkId must be kebab-case: ${report.checkId}`)
    if (!report.checkName.trim()) throw new Error(`checkName is required for ${report.checkId}`)
    if (!CATEGORIES.includes(report.category)) throw new Error(`unsupported category for ${report.checkId}: ${report.category}`)
    if (!report.command.trim()) throw new Error(`command is required for ${report.checkId}`)
    if (!STATUSES.includes(report.status)) throw new Error(`unsupported status for ${report.checkId}: ${report.status}`)
    if (!Number.isFinite(report.durationMs) || report.durationMs < 0) throw new Error(`durationMs must be a non-negative finite number for ${report.checkId}`)
    if (Number.isNaN(Date.parse(report.timestamp))) throw new Error(`timestamp must be ISO-like for ${report.checkId}: ${report.timestamp}`)
    if (Number.isNaN(Date.parse(report.startedAt))) throw new Error(`startedAt must be ISO-like for ${report.checkId}: ${report.startedAt}`)
    if (Number.isNaN(Date.parse(report.endedAt))) throw new Error(`endedAt must be ISO-like for ${report.checkId}: ${report.endedAt}`)
    if (Date.parse(report.endedAt) < Date.parse(report.startedAt)) throw new Error(`endedAt must be >= startedAt for ${report.checkId}`)
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

function isCheckReportFile(name: string): boolean {
    return name.endsWith('.json') && CHECK_ID_PATTERN.test(name.slice(0, -'.json'.length))
}

async function readCheckReport(path: string): Promise<CheckReport | null> {
    try {
        const parsed = normalizeLegacyTimingFields(JSON.parse(await readFile(path, 'utf8')) as CheckReportCandidate) as CheckReport
        assertCheckReport(parsed)
        return parsed
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

async function readAllCheckReports(): Promise<CheckReport[]> {
    let entries: readonly {isFile(): boolean; name: string}[]
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
    if (report.status !== 'skip') {
        await appendScore({measure: `check/${report.checkId}`, score: report.durationMs, status: report.status})
    }
    await writeChecksAggregate()
}
