export interface Args {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly bootTimeoutMs: number
    readonly settleAfterStormMs: number
    readonly outPath: string | null
    readonly keepArtifacts: boolean
}

export interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly exitCode: number | null
    readonly exitedAtMs: number | null
    readonly errorMessage?: string
}
