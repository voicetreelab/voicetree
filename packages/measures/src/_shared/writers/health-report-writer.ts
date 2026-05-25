import {readdir, readFile, rename, unlink, writeFile, mkdir} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {appendScore} from './scores-history-writer.ts'

const CI_REPORTING_SRC_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(CI_REPORTING_SRC_ROOT, '..', '..', '..', '..', '..')
const REPORTS_DIR: string = join(REPO_ROOT, 'health-dashboard', 'reports')
const LATEST_REPORT_PATH: string = join(REPORTS_DIR, 'latest.json')
const METRIC_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const CATEGORIES = ['Coupling', 'Complexity', 'Purity', 'Behavioral', 'Shape', 'Churn', 'Structure', 'Other'] as const
const COMPARISONS = ['lte', 'gte'] as const
const SEVERITIES = ['gate', 'warning'] as const

export type HealthReport = {
    readonly metricId: string
    readonly metricName: string
    readonly description: string
    readonly category: typeof CATEGORIES[number]
    readonly current: number
    readonly budget: number
    readonly comparison: typeof COMPARISONS[number]
    readonly passed: boolean
    readonly severity?: typeof SEVERITIES[number]
    readonly unit?: string
    readonly timestamp: string
    readonly details?: Record<string, unknown>
}

type LatestHealthReports = {
    readonly generatedAt: string
    readonly reports: readonly HealthReport[]
}

function metricReportPath(metricId: string): string {
    return join(REPORTS_DIR, `${metricId}.json`)
}

function assertMetricId(metricId: string): void {
    if (!METRIC_ID_PATTERN.test(metricId)) throw new Error(`metricId must be kebab-case: ${metricId}`)
}

function passStatus(report: HealthReport): boolean {
    return report.comparison === 'lte'
        ? report.current <= report.budget
        : report.current >= report.budget
}

function assertHealthReport(report: HealthReport): void {
    assertMetricId(report.metricId)
    if (!report.metricName.trim()) throw new Error(`metricName is required for ${report.metricId}`)
    if (!report.description.trim()) throw new Error(`description is required for ${report.metricId}`)
    if (!CATEGORIES.includes(report.category)) throw new Error(`unsupported category for ${report.metricId}: ${report.category}`)
    if (!Number.isFinite(report.current)) throw new Error(`current must be finite for ${report.metricId}`)
    if (!Number.isFinite(report.budget)) throw new Error(`budget must be finite for ${report.metricId}`)
    if (!COMPARISONS.includes(report.comparison)) throw new Error(`unsupported comparison for ${report.metricId}: ${report.comparison}`)
    if (report.severity !== undefined && !SEVERITIES.includes(report.severity)) throw new Error(`unsupported severity for ${report.metricId}: ${report.severity}`)
    if (Number.isNaN(Date.parse(report.timestamp))) throw new Error(`timestamp must be ISO-like for ${report.metricId}: ${report.timestamp}`)
    if (report.passed !== passStatus(report)) throw new Error(`passed does not match ${report.comparison} comparison for ${report.metricId}`)
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

function isMetricReportFile(name: string): boolean {
    return name.endsWith('.json')
        && name !== 'latest.json'
        && name !== 'checks.json'
        && METRIC_ID_PATTERN.test(name.slice(0, -'.json'.length))
}

async function readMetricReport(path: string): Promise<HealthReport | null> {
    try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as HealthReport
        assertHealthReport(parsed)
        return parsed
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
    }
}

async function readAllMetricReports(): Promise<HealthReport[]> {
    const entries = await readdir(REPORTS_DIR, {withFileTypes: true})
    const reports = await Promise.all(entries
        .filter(entry => entry.isFile() && isMetricReportFile(entry.name))
        .map(entry => readMetricReport(join(REPORTS_DIR, entry.name))))

    return reports
        .filter((report): report is HealthReport => report !== null)
        .sort((a, b) => `${a.category}:${a.metricName}:${a.metricId}`.localeCompare(`${b.category}:${b.metricName}:${b.metricId}`))
}

async function writeLatestReport(): Promise<void> {
    const latest: LatestHealthReports = {
        generatedAt: new Date().toISOString(),
        reports: await readAllMetricReports(),
    }
    await writeJsonAtomic(LATEST_REPORT_PATH, latest)
}

export async function recordHealthReport(report: HealthReport): Promise<void> {
    assertHealthReport(report)
    await mkdir(REPORTS_DIR, {recursive: true})
    await writeJsonAtomic(metricReportPath(report.metricId), report)
    await appendScore({measure: report.metricId, score: report.current})
    await writeLatestReport()
}

export async function removeHealthReports(metricIds: readonly string[]): Promise<void> {
    await mkdir(REPORTS_DIR, {recursive: true})
    await Promise.all(metricIds.map(async metricId => {
        assertMetricId(metricId)
        await unlink(metricReportPath(metricId)).catch(err => {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        })
    }))
    await writeLatestReport()
}
