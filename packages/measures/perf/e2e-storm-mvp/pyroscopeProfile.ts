import { readFile } from 'node:fs/promises'
import { convertV8CpuProfileToPprof } from '@vt/perf-analysis/v8-cpuprofile-to-pprof'

const DEFAULT_PYROSCOPE_URL = 'http://localhost:2995'

export interface PyroscopeUploadResult {
    readonly serviceName: string
    readonly serviceInstanceId: string
    readonly postedTo: string
    readonly renderQuery: string
    readonly sampleCount: number
    readonly functionCount: number
}

function unixSeconds(ms: number): number {
    return Math.floor(ms / 1_000)
}

function assertPyroscopeLabelKey(key: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`invalid Pyroscope label key: ${key}`)
    }
}

function assertPyroscopeLabelValue(key: string, value: string): void {
    if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
        throw new Error(`invalid Pyroscope label value for ${key}: ${value}`)
    }
}

function pyroscopeLabelSet(labels: Readonly<Record<string, string>>): string {
    return Object.entries(labels)
        .map(([key, value]) => {
            assertPyroscopeLabelKey(key)
            assertPyroscopeLabelValue(key, value)
            return `${key}=${value}`
        })
        .join(',')
}

function ingestUrl(args: {
    readonly pyroscopeUrl: string
    readonly serviceName: string
    readonly runUuid: string
    readonly startedAtMs: number
    readonly stoppedAtMs: number
}): string {
    const url = new URL('/ingest', args.pyroscopeUrl)
    const from = unixSeconds(args.startedAtMs)
    url.searchParams.set(
        'name',
        `${args.serviceName}{${pyroscopeLabelSet({ service_instance_id: args.runUuid })}}`,
    )
    url.searchParams.set('from', String(from))
    url.searchParams.set('until', String(Math.max(from + 1, unixSeconds(args.stoppedAtMs))))
    url.searchParams.set('spyName', 'nodespy')
    return url.toString()
}

function renderQuery(serviceName: string, runUuid: string): string {
    return `process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name="${serviceName}",service_instance_id="${runUuid}"}`
}

export async function uploadV8CpuProfileToPyroscope(args: {
    readonly cpuprofilePath: string
    readonly serviceName: string
    readonly runUuid: string
    readonly pyroscopeUrl?: string
    readonly stoppedAtMs?: number
}): Promise<PyroscopeUploadResult> {
    const profile = JSON.parse(await readFile(args.cpuprofilePath, 'utf8')) as unknown
    const converted = convertV8CpuProfileToPprof(profile, { stoppedAtMs: args.stoppedAtMs ?? Date.now() })
    const postedTo = ingestUrl({
        pyroscopeUrl: args.pyroscopeUrl ?? process.env.PYROSCOPE_URL ?? DEFAULT_PYROSCOPE_URL,
        serviceName: args.serviceName,
        runUuid: args.runUuid,
        startedAtMs: converted.summary.startedAtMs,
        stoppedAtMs: converted.summary.stoppedAtMs,
    })

    const formData = new FormData()
    formData.append('profile', new Blob([converted.pprofBuffer]), 'profile.pb')
    const response = await fetch(postedTo, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Pyroscope ingest failed for ${args.serviceName}: HTTP ${response.status} ${body.trim()}`)
    }

    return {
        serviceName: args.serviceName,
        serviceInstanceId: args.runUuid,
        postedTo,
        renderQuery: renderQuery(args.serviceName, args.runUuid),
        sampleCount: converted.summary.sampleCount,
        functionCount: converted.summary.functionCount,
    }
}
