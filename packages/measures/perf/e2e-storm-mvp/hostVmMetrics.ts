import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { finished } from 'node:stream/promises'

export interface HostVmMetricsSummary {
    readonly sampleCount: number
    readonly cpuCount: number
    readonly cpuUsedPctAvg: number
    readonly cpuUsedPctMax: number
    readonly cpuIowaitPctMax: number
    readonly cpuStealPctMax: number
    readonly load1PerCpuPctMax: number
    readonly memUsedPctAvg: number
    readonly memUsedPctMax: number
    readonly memAvailableBytesMin: number
}

interface CpuSnapshot {
    readonly total: number
    readonly busy: number
    readonly idle: number
    readonly iowait: number
    readonly steal: number
}

interface MemSnapshot {
    readonly totalBytes: number
    readonly availableBytes: number
    readonly usedBytes: number
    readonly usedPct: number
}

interface HostVmMetricRow {
    readonly t: number
    readonly svc: 'devbox-vm'
    readonly cpu_count: number
    readonly cpu_used_pct: number
    readonly cpu_idle_pct: number
    readonly cpu_iowait_pct: number
    readonly cpu_steal_pct: number
    readonly load_1m: number
    readonly load_1m_per_cpu_pct: number
    readonly mem_total_bytes: number
    readonly mem_available_bytes: number
    readonly mem_used_bytes: number
    readonly mem_used_pct: number
}

export interface HostVmMetricsSampler {
    readonly metricsPath: string
    readonly stop: () => Promise<HostVmMetricsSummary>
}

export function parseHostCpuSnapshot(procStat: string): CpuSnapshot {
    const cpuLine = procStat.split('\n').find(line => line.startsWith('cpu '))
    if (!cpuLine) throw new Error('missing aggregate cpu line in /proc/stat')
    const fields = cpuLine.trim().split(/\s+/).slice(1).map(value => Number.parseInt(value, 10))
    if (fields.length < 8 || fields.some(value => !Number.isFinite(value))) {
        throw new Error('invalid aggregate cpu line in /proc/stat')
    }

    const idle = fields[3] ?? 0
    const iowait = fields[4] ?? 0
    const steal = fields[7] ?? 0
    const total = fields.reduce((sum, value) => sum + value, 0)
    return {
        total,
        busy: total - idle - iowait,
        idle,
        iowait,
        steal,
    }
}

export function parseHostMemSnapshot(meminfo: string): MemSnapshot {
    const values = new Map<string, number>()
    for (const line of meminfo.split('\n')) {
        const match = /^([^:]+):\s+(\d+)\s+kB$/.exec(line)
        if (match) values.set(match[1], Number.parseInt(match[2], 10) * 1024)
    }

    const totalBytes = values.get('MemTotal')
    const availableBytes = values.get('MemAvailable')
    if (!totalBytes || availableBytes === undefined) {
        throw new Error('missing MemTotal or MemAvailable in /proc/meminfo')
    }

    const usedBytes = totalBytes - availableBytes
    return {
        totalBytes,
        availableBytes,
        usedBytes,
        usedPct: totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100,
    }
}

export function parseLoad1(loadavg: string): number {
    const rawLoad1 = loadavg.trim().split(/\s+/)[0]
    const load1 = Number.parseFloat(rawLoad1 ?? '')
    if (!Number.isFinite(load1)) throw new Error('invalid /proc/loadavg')
    return load1
}

export function summarizeHostVmMetricRows(rows: readonly HostVmMetricRow[]): HostVmMetricsSummary {
    if (rows.length === 0) {
        return {
            sampleCount: 0,
            cpuCount: 0,
            cpuUsedPctAvg: 0,
            cpuUsedPctMax: 0,
            cpuIowaitPctMax: 0,
            cpuStealPctMax: 0,
            load1PerCpuPctMax: 0,
            memUsedPctAvg: 0,
            memUsedPctMax: 0,
            memAvailableBytesMin: 0,
        }
    }

    const sum = (pick: (row: HostVmMetricRow) => number): number => rows.reduce((total, row) => total + pick(row), 0)
    const max = (pick: (row: HostVmMetricRow) => number): number => Math.max(...rows.map(pick))
    const min = (pick: (row: HostVmMetricRow) => number): number => Math.min(...rows.map(pick))

    return {
        sampleCount: rows.length,
        cpuCount: rows[0]?.cpu_count ?? 0,
        cpuUsedPctAvg: sum(row => row.cpu_used_pct) / rows.length,
        cpuUsedPctMax: max(row => row.cpu_used_pct),
        cpuIowaitPctMax: max(row => row.cpu_iowait_pct),
        cpuStealPctMax: max(row => row.cpu_steal_pct),
        load1PerCpuPctMax: max(row => row.load_1m_per_cpu_pct),
        memUsedPctAvg: sum(row => row.mem_used_pct) / rows.length,
        memUsedPctMax: max(row => row.mem_used_pct),
        memAvailableBytesMin: min(row => row.mem_available_bytes),
    }
}

function pct(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : (numerator / denominator) * 100
}

function hostVmMetricRow(
    previousCpu: CpuSnapshot,
    currentCpu: CpuSnapshot,
    mem: MemSnapshot,
    load1: number,
    cpuCount: number,
): HostVmMetricRow {
    const deltaTotal = currentCpu.total - previousCpu.total
    return {
        t: Date.now(),
        svc: 'devbox-vm',
        cpu_count: cpuCount,
        cpu_used_pct: pct(currentCpu.busy - previousCpu.busy, deltaTotal),
        cpu_idle_pct: pct(currentCpu.idle - previousCpu.idle, deltaTotal),
        cpu_iowait_pct: pct(currentCpu.iowait - previousCpu.iowait, deltaTotal),
        cpu_steal_pct: pct(currentCpu.steal - previousCpu.steal, deltaTotal),
        load_1m: load1,
        load_1m_per_cpu_pct: cpuCount === 0 ? 0 : (load1 / cpuCount) * 100,
        mem_total_bytes: mem.totalBytes,
        mem_available_bytes: mem.availableBytes,
        mem_used_bytes: mem.usedBytes,
        mem_used_pct: mem.usedPct,
    }
}

export async function startHostVmMetricsSampler(
    metricsPath: string,
    intervalMs = 1000,
): Promise<HostVmMetricsSampler> {
    await mkdir(path.dirname(metricsPath), { recursive: true })
    const stream = createWriteStream(metricsPath, { flags: 'a' })
    const rows: HostVmMetricRow[] = []
    const cpuCount = os.cpus().length
    let previousCpu = parseHostCpuSnapshot(readFileSync('/proc/stat', 'utf8'))
    let stopped = false

    const writeRow = (): void => {
        if (stopped) return
        const currentCpu = parseHostCpuSnapshot(readFileSync('/proc/stat', 'utf8'))
        const mem = parseHostMemSnapshot(readFileSync('/proc/meminfo', 'utf8'))
        const load1 = parseLoad1(readFileSync('/proc/loadavg', 'utf8'))
        const row = hostVmMetricRow(previousCpu, currentCpu, mem, load1, cpuCount)
        previousCpu = currentCpu
        rows.push(row)
        stream.write(`${JSON.stringify(row)}\n`)
    }

    const interval = setInterval(() => {
        try {
            writeRow()
        } catch (error) {
            process.stderr.write(`[mvp] devbox-vm metrics sample failed: ${(error as Error).message}\n`)
        }
    }, intervalMs)
    interval.unref()

    return {
        metricsPath,
        stop: async () => {
            if (!stopped) {
                try {
                    writeRow()
                } catch (error) {
                    process.stderr.write(`[mvp] devbox-vm final metrics sample failed: ${(error as Error).message}\n`)
                } finally {
                    stopped = true
                    clearInterval(interval)
                    stream.end()
                    await finished(stream)
                }
            }
            return summarizeHostVmMetricRows(rows)
        },
    }
}
