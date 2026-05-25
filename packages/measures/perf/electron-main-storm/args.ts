import type { Args } from './types.ts'

export function parseArgs(argv: readonly string[]): Args {
    const defaults: Args = {
        agents: 5,
        nodesPerAgent: 5,
        vaultSeedNodeCount: 200,
        perAgentTimeoutMs: 60_000,
        bootTimeoutMs: 60_000,
        settleAfterStormMs: 2_000,
        outPath: null,
        keepArtifacts: false,
    }
    let agents = defaults.agents
    let nodesPerAgent = defaults.nodesPerAgent
    let vaultSeedNodeCount = defaults.vaultSeedNodeCount
    let perAgentTimeoutMs = defaults.perAgentTimeoutMs
    let bootTimeoutMs = defaults.bootTimeoutMs
    let settleAfterStormMs = defaults.settleAfterStormMs
    let outPath = defaults.outPath
    let keepArtifacts = defaults.keepArtifacts

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
            case '--boot-timeout-ms': bootTimeoutMs = intArg(argv[++i], 'boot-timeout-ms'); break
            case '--settle-after-storm-ms': settleAfterStormMs = intArg(argv[++i], 'settle-after-storm-ms'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--keep-artifacts': keepArtifacts = true; break
            case '--help':
            case '-h':
                process.stdout.write(
                    'electron-main-storm.ts: profile Electron main CPU under an N-agent fake-agent storm.\n'
                    + '  --agents N                    parallel fake-agents (default 5)\n'
                    + '  --nodes-per-agent N           create_node actions per agent (default 5)\n'
                    + '  --vault-seed-nodes N          seed-vault size (default 200)\n'
                    + '  --per-agent-timeout-ms MS     per-agent completion deadline (default 60000)\n'
                    + '  --boot-timeout-ms MS          how long to wait for app boot + .mcp.json (default 60000)\n'
                    + '  --settle-after-storm-ms MS   keep profiling N ms after last agent exits (default 2000)\n'
                    + '  --out PATH                    .cpuprofile path (default ~/.voicetree/reports/electron-main-storm-<ts>.cpuprofile)\n'
                    + '  --keep-artifacts              keep temp vault + userData after the run\n',
                )
                process.exit(0)
                break
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }
    return {
        agents, nodesPerAgent, vaultSeedNodeCount, perAgentTimeoutMs,
        bootTimeoutMs, settleAfterStormMs, outPath, keepArtifacts,
    }
}
