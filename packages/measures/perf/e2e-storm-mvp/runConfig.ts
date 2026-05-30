/**
 * Run configuration for the e2e-storm-mvp: CLI arg parsing, per-run context
 * (uuid + dirs + OTLP env), and the VoiceTree `settings.json` the seeded app
 * boots against.
 *
 * Extracted from index.ts. `parseArgs` is pure; `resolveRunContext` and
 * `writeStormSettings` push their impurity (env reads, fs writes) to a single
 * call each so the orchestrator stays readable.
 *
 * Baseline load is 50 agents × 8 nodes = 400 nodes — deliberately in the
 * >300-node regime where the user observes perf degradation, so a baseline run
 * is a meaningful comparison point for the experiment loop.
 */
import * as path from 'node:path'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

import {
    buildFakeAgentCommand,
    buildMultiCreateNodeScript,
    buildStormAgentPrompt,
    promptTemplateName,
} from './runFakeAgent.ts'

export const DEFAULT_AGENT_COUNT = 50
export const DEFAULT_NODES_PER_AGENT = 8
export const STORM_CALLER_COMMAND = 'sleep 120'

export interface Args {
    readonly keepArtifacts: boolean
    readonly daemonDiscoveryTimeoutMs: number
    readonly agentTimeoutMs: number
    readonly inspectPort: number
    readonly outPath: string | null
    readonly agentCount: number
    readonly nodesPerAgent: number
}

export interface RunContext {
    readonly runUuid: string
    readonly runDir: string
    readonly otlpEndpoint?: string
    readonly perfEnv: Readonly<Record<string, string>>
}

export function resolveRunContext(env: NodeJS.ProcessEnv = process.env): RunContext {
    const runUuid = env.VOICETREE_RUN_INSTANCE_ID && env.VOICETREE_RUN_INSTANCE_ID.length > 0
        ? env.VOICETREE_RUN_INSTANCE_ID
        : randomUUID()
    const runDir = path.join(homedir(), '.voicetree', 'perf', runUuid)
    const otlpEndpoint = env.VOICETREE_OTLP_ENDPOINT && env.VOICETREE_OTLP_ENDPOINT.length > 0
        ? env.VOICETREE_OTLP_ENDPOINT
        : undefined
    const perfEnv: Record<string, string> = {
        VOICETREE_RUN_INSTANCE_ID: runUuid,
        VOICETREE_PERF_TIER: 'deep',
    }
    if (otlpEndpoint !== undefined) perfEnv.VOICETREE_OTLP_ENDPOINT = otlpEndpoint
    env.VOICETREE_RUN_INSTANCE_ID = runUuid

    return { runUuid, runDir, otlpEndpoint, perfEnv }
}

export function parseArgs(argv: readonly string[]): Args {
    let keepArtifacts = false
    let daemonDiscoveryTimeoutMs = 120_000
    let agentTimeoutMs = 60_000
    let inspectPort = 9244
    let outPath: string | null = null
    let agentCount = DEFAULT_AGENT_COUNT
    let nodesPerAgent = DEFAULT_NODES_PER_AGENT

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--keep-artifacts': keepArtifacts = true; break
            case '--daemon-discovery-timeout-ms': daemonDiscoveryTimeoutMs = intArg(argv[++i], 'daemon-discovery-timeout-ms'); break
            case '--agent-timeout-ms': agentTimeoutMs = intArg(argv[++i], 'agent-timeout-ms'); break
            case '--inspect-port': inspectPort = intArg(argv[++i], 'inspect-port'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--agents': agentCount = intArg(argv[++i], 'agents'); break
            case '--nodes-per-agent': nodesPerAgent = intArg(argv[++i], 'nodes-per-agent'); break
            case '--help':
            case '-h':
                process.stdout.write(
                    'e2e-storm-mvp: prove headful-Electron + daemon + fake-agent end-to-end.\n'
                    + `  --agents N                        parallel fake-agents (default ${DEFAULT_AGENT_COUNT})\n`
                    + `  --nodes-per-agent N               nodes created per fake agent (default ${DEFAULT_NODES_PER_AGENT})\n`
                    + '  --daemon-discovery-timeout-ms MS  default 120000\n'
                    + '  --agent-timeout-ms MS             default 60000\n'
                    + '  --inspect-port N                  default 9244\n'
                    + '  --keep-artifacts                  keep temp dirs after the run\n'
                    + '  --out PATH                        report path (default ~/.voicetree/perf/<run-id>/e2e-storm-mvp-report.json)\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }

    return { keepArtifacts, daemonDiscoveryTimeoutMs, agentTimeoutMs, inspectPort, outPath, agentCount, nodesPerAgent }
}

export function writeStormSettings(voicetreeHomePath: string, args: Args, repoRoot: string): void {
    const injectedPrompts = Object.fromEntries(
        Array.from({ length: args.agentCount }, (_, agentIndex) => [
            promptTemplateName(agentIndex),
            buildStormAgentPrompt(buildMultiCreateNodeScript(agentIndex, args.nodesPerAgent)),
        ]),
    )
    writeFileSync(
        path.join(voicetreeHomePath, 'settings.json'),
        JSON.stringify({
            agents: [
                { name: 'Storm Caller', command: STORM_CALLER_COMMAND },
                { name: 'Fake Agent', command: buildFakeAgentCommand(repoRoot) },
            ],
            defaultAgent: 'Storm Caller',
            terminalSpawnPathRelativeToWatchedDirectory: '/',
            INJECT_ENV_VARS: {
                AGENT_PROMPT: '',
                ...injectedPrompts,
            },
        }, null, 2),
        'utf8',
    )
}
