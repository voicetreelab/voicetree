import type { Args } from './types'

export function parseArgs(argv: readonly string[]): Args {
    const defaults: Args = {
        agents: 5,
        nodesPerAgent: 5,
        vaultSeedNodeCount: 200,
        perAgentTimeoutMs: 60_000,
        globalTimeoutMs: 5 * 60_000,
        outPath: null,
        keepArtifacts: false,
        isolateDirs: false,
    }
    let agents = defaults.agents
    let nodesPerAgent = defaults.nodesPerAgent
    let vaultSeedNodeCount = defaults.vaultSeedNodeCount
    let perAgentTimeoutMs = defaults.perAgentTimeoutMs
    let globalTimeoutMs = defaults.globalTimeoutMs
    let outPath = defaults.outPath
    let keepArtifacts = defaults.keepArtifacts
    let isolateDirs = defaults.isolateDirs

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--agents': agents = intArg(argv[++i], 'agents'); break
            case '--nodes-per-agent': nodesPerAgent = intArg(argv[++i], 'nodes-per-agent'); break
            case '--vault-seed-nodes': vaultSeedNodeCount = intArg(argv[++i], 'vault-seed-nodes'); break
            case '--per-agent-timeout-ms': perAgentTimeoutMs = intArg(argv[++i], 'per-agent-timeout-ms'); break
            case '--global-timeout-ms': globalTimeoutMs = intArg(argv[++i], 'global-timeout-ms'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--keep-artifacts': keepArtifacts = true; break
            case '--isolate-dirs': isolateDirs = true; break
            case '--help':
            case '-h':
                process.stdout.write(
                    'agent-storm.ts: spawn N vt-fake-agents and measure daemon-side OTel signals.\n'
                    + '  --agents N                    parallel fake-agents (default 5)\n'
                    + '  --nodes-per-agent N           create_nodes actions per agent (default 5)\n'
                    + '  --vault-seed-nodes N          existing nodes to seed the vault with (default 200)\n'
                    + '  --per-agent-timeout-ms MS     per-agent completion deadline (default 60000)\n'
                    + '  --global-timeout-ms MS        overall run deadline (default 300000)\n'
                    + '  --out PATH                    JSON report path (default ~/.voicetree/reports/perf-agent-storm-<ts>.json)\n'
                    + '  --keep-artifacts              keep temp vault + app-support dirs after the run\n'
                    + '  --isolate-dirs                give each agent a unique outputDir under <vault>/isolated/agent-<i>/ (probe per-dir FS contention)\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }
    return { agents, nodesPerAgent, vaultSeedNodeCount, perAgentTimeoutMs, globalTimeoutMs, outPath, keepArtifacts, isolateDirs }
}
