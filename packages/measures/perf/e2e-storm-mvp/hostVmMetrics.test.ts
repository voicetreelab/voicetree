import { describe, expect, it } from 'vitest'

import {
    parseHostCpuSnapshot,
    parseHostMemSnapshot,
    parseLoad1,
    summarizeHostVmMetricRows,
} from './hostVmMetrics.ts'

describe('hostVmMetrics', () => {
    it('parses aggregate cpu counters from /proc/stat', () => {
        expect(parseHostCpuSnapshot('cpu  100 5 25 870 10 0 4 2 0 0\ncpu0 1 2 3 4\n')).toEqual({
            total: 1016,
            busy: 136,
            idle: 870,
            iowait: 10,
            steal: 2,
        })
    })

    it('parses used memory as total minus available', () => {
        expect(parseHostMemSnapshot('MemTotal:       1024 kB\nMemFree:          40 kB\nMemAvailable:    256 kB\n')).toEqual({
            totalBytes: 1048576,
            availableBytes: 262144,
            usedBytes: 786432,
            usedPct: 75,
        })
    })

    it('parses one minute load average', () => {
        expect(parseLoad1('3.25 1.00 0.40 2/100 1234\n')).toBe(3.25)
    })

    it('summarizes host rows for bottleneck diagnosis', () => {
        const summary = summarizeHostVmMetricRows([
            {
                t: 1,
                svc: 'devbox-vm',
                cpu_count: 4,
                cpu_used_pct: 50,
                cpu_idle_pct: 49,
                cpu_iowait_pct: 1,
                cpu_steal_pct: 0,
                load_1m: 2,
                load_1m_per_cpu_pct: 50,
                mem_total_bytes: 1000,
                mem_available_bytes: 400,
                mem_used_bytes: 600,
                mem_used_pct: 60,
            },
            {
                t: 2,
                svc: 'devbox-vm',
                cpu_count: 4,
                cpu_used_pct: 80,
                cpu_idle_pct: 16,
                cpu_iowait_pct: 4,
                cpu_steal_pct: 2,
                load_1m: 5,
                load_1m_per_cpu_pct: 125,
                mem_total_bytes: 1000,
                mem_available_bytes: 250,
                mem_used_bytes: 750,
                mem_used_pct: 75,
            },
        ])

        expect(summary).toEqual({
            sampleCount: 2,
            cpuCount: 4,
            cpuUsedPctAvg: 65,
            cpuUsedPctMax: 80,
            cpuIowaitPctMax: 4,
            cpuStealPctMax: 2,
            load1PerCpuPctMax: 125,
            memUsedPctAvg: 67.5,
            memUsedPctMax: 75,
            memAvailableBytesMin: 250,
        })
    })
})
