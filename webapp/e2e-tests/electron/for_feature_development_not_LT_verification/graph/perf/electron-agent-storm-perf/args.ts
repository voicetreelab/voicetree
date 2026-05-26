export interface E2EArgs {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly keepArtifacts: boolean
}

function intEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad env ${key}=${raw}`)
    return n
}

function boolEnv(key: string): boolean {
    const raw = process.env[key]
    return raw === '1' || raw === 'true'
}

export function parseArgs(): E2EArgs {
    return {
        agents: intEnv('PERF_E2E_AGENTS', 8),
        nodesPerAgent: intEnv('PERF_E2E_NODES_PER_AGENT', 30),
        vaultSeedNodeCount: intEnv('PERF_E2E_VAULT_SEED_NODES', 300),
        perAgentTimeoutMs: intEnv('PERF_E2E_PER_AGENT_TIMEOUT_MS', 120_000),
        globalTimeoutMs: intEnv('PERF_E2E_GLOBAL_TIMEOUT_MS', 10 * 60_000),
        keepArtifacts: boolEnv('PERF_E2E_KEEP_ARTIFACTS'),
    }
}
