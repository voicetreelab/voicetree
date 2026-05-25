export interface Args {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly outPath: string | null
    readonly keepArtifacts: boolean
    readonly isolateDirs: boolean
}

export interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly startedAtMs: number
    readonly exitedAtMs: number | null
    readonly exitCode: number | null
    readonly stdoutSnippet: string
    readonly errorMessage?: string
}

export interface SpanRecord {
    readonly traceId: string
    readonly spanId: string
    readonly name: string
    readonly durationMs: number
    readonly attributes: Record<string, unknown>
}

export interface SpanSummary {
    readonly totalNew: number
    readonly byName: Record<string, number>
    readonly byOutcome: Record<string, number>
    readonly durationsMs: Record<string, { p50: number; p95: number; p99: number; max: number }>
}
