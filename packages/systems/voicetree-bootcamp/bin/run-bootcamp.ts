#!/usr/bin/env tsx
/**
 * v2 CLI entry. Runs one bootcamp scenario cell end-to-end:
 *
 *   vt-bootcamp <scenarioId> [options]
 *
 * Thin shell: resolves the scenario from the registry, picks the driver
 * from the model name, drives `runScenario` once per --reps, and prints
 * either a rendered report or raw JSON. All real work happens behind
 * `runScenario` (src/runner.ts) and `renderCellResults` (src/report.ts);
 * this file is just arg parsing + orchestration + exit codes.
 *
 * The runner and report modules are loaded via dynamic import so --help
 * and --dry-run never touch them — keeps the fast paths fast and isolates
 * cross-agent integration to a single line each.
 */
import {parseArgs} from 'node:util'
import {claudeCodeDriver} from '../src/drivers/claude.ts'
import {codexDriver} from '../src/drivers/codex.ts'
import {SCENARIOS} from '../src/scenarios/index.ts'
import type {CellResult, Effort, HarnessDriver, ScenarioSpec} from '../src/types.ts'

const USAGE = `vt-bootcamp <scenarioId> [options]

Run one bootcamp scenario cell end-to-end (setup → harness → score → report).

Arguments:
  <scenarioId>              One of ${SCENARIOS.map((s) => s.id).join(', ')} (case-insensitive)

Options:
  --model <name>            Model to test (e.g. opus, sonnet, haiku, codex-1). Required.
  --effort <low|med|high>   Effort level. Default: medium.
  --mode <headless|headful> Run mode. Default: headless.
                            Headful launches VoiceTree pointing at the project and
                            waits for the per-project daemon before running the agent,
                            so you can watch the graph populate live.
  --reps <N>                Number of repetitions. Default: 1.
  --workspace-root <path>   Stable workspace dir (project is created at <path>/project).
                            Optional — defaults to a fresh mkdtemp dir. Useful in
                            headful mode if you want a deterministic path to revisit.
  --headful-daemon-timeout-ms <N>
                            How long to wait for VoiceTree's per-project daemon to
                            come up (rpc.port appears) before failing. Default: 60000.
  --json                    Emit raw CellResult[] as JSON (for piping).
  --dry-run                 Print resolved plan as JSON and exit without invoking the runner.
  --help, -h                Show this help.
`

const DRIVERS: readonly HarnessDriver[] = [claudeCodeDriver, codexDriver]

type Mode = 'headless' | 'headful'

type Config = {
    readonly scenario: ScenarioSpec
    readonly driver: HarnessDriver
    readonly model: string
    readonly effort: Effort
    readonly mode: Mode
    readonly reps: number
    readonly json: boolean
    readonly dryRun: boolean
    readonly workspaceRoot: string | undefined
    readonly headfulDaemonReadyTimeoutMs: number | undefined
}

function die(msg: string, exitCode = 2): never {
    process.stderr.write(`vt-bootcamp: ${msg}\n\n${USAGE}`)
    process.exit(exitCode)
}

function parseEffort(s: string): Effort {
    if (s === 'low' || s === 'medium' || s === 'high') return s
    die(`--effort must be one of: low, medium, high (got: ${s})`)
}

function parseMode(s: string): Mode {
    if (s === 'headless' || s === 'headful') return s
    die(`--mode must be one of: headless, headful (got: ${s})`)
}

function parseReps(s: string): number {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) die(`--reps must be a positive integer (got: ${s})`)
    return n
}

function parsePositiveInt(flag: string, s: string): number {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) die(`${flag} must be a positive integer (got: ${s})`)
    return n
}

function resolveScenario(rawId: string): ScenarioSpec {
    const want = rawId.toUpperCase()
    const found = SCENARIOS.find((s) => s.id.toUpperCase() === want)
    if (!found) {
        die(`unknown scenario: ${rawId} (available: ${SCENARIOS.map((s) => s.id).join(', ')})`)
    }
    return found
}

function resolveDriver(model: string): HarnessDriver {
    const found = DRIVERS.find((d) => d.models.includes(model))
    if (!found) {
        const all = DRIVERS.flatMap((d) => d.models).join(', ')
        die(`unknown model: ${model} (available: ${all})`)
    }
    return found
}

function parseConfig(argv: readonly string[]): Config {
    let parsed: ReturnType<typeof parseArgs>
    try {
        parsed = parseArgs({
            args: [...argv],
            allowPositionals: true,
            options: {
                model: {type: 'string'},
                effort: {type: 'string'},
                mode: {type: 'string'},
                reps: {type: 'string'},
                json: {type: 'boolean'},
                'dry-run': {type: 'boolean'},
                help: {type: 'boolean', short: 'h'},
                'workspace-root': {type: 'string'},
                'headful-daemon-timeout-ms': {type: 'string'},
            },
        })
    } catch (err) {
        die(err instanceof Error ? err.message : String(err))
    }

    if (parsed.values.help) {
        process.stdout.write(USAGE)
        process.exit(0)
    }

    if (parsed.positionals.length === 0) die('missing required <scenarioId>')
    if (parsed.positionals.length > 1) {
        die(`unexpected positional args: ${parsed.positionals.slice(1).join(' ')}`)
    }

    const scenario = resolveScenario(parsed.positionals[0])

    const modelRaw = parsed.values.model
    if (typeof modelRaw !== 'string' || modelRaw.length === 0) die('--model is required')
    const model = modelRaw
    const driver = resolveDriver(model)

    const effort = typeof parsed.values.effort === 'string'
        ? parseEffort(parsed.values.effort)
        : 'medium'
    const mode = typeof parsed.values.mode === 'string'
        ? parseMode(parsed.values.mode)
        : 'headless'
    const reps = typeof parsed.values.reps === 'string'
        ? parseReps(parsed.values.reps)
        : 1

    const workspaceRoot = typeof parsed.values['workspace-root'] === 'string'
        ? parsed.values['workspace-root']
        : undefined
    const headfulDaemonReadyTimeoutMs =
        typeof parsed.values['headful-daemon-timeout-ms'] === 'string'
            ? parsePositiveInt(
                  '--headful-daemon-timeout-ms',
                  parsed.values['headful-daemon-timeout-ms'],
              )
            : undefined

    return {
        scenario,
        driver,
        model,
        effort,
        mode,
        reps,
        json: parsed.values.json === true,
        dryRun: parsed.values['dry-run'] === true,
        workspaceRoot,
        headfulDaemonReadyTimeoutMs,
    }
}

function dryRunPlan(cfg: Config): string {
    const plan = {
        scenarioId: cfg.scenario.id,
        scenarioName: cfg.scenario.name,
        driver: cfg.driver.name,
        model: cfg.model,
        effort: cfg.effort,
        mode: cfg.mode,
        reps: cfg.reps,
        json: cfg.json,
        workspaceRoot: cfg.workspaceRoot,
        headfulDaemonReadyTimeoutMs: cfg.headfulDaemonReadyTimeoutMs,
    }
    return JSON.stringify(plan, null, 2)
}

async function main(): Promise<void> {
    const cfg = parseConfig(process.argv.slice(2))

    if (cfg.dryRun) {
        process.stdout.write(`${dryRunPlan(cfg)}\n`)
        process.exit(0)
    }

    // Lazy: only load runner/report when we actually need to run a cell.
    // Keeps --help / --dry-run independent of peer modules + faster startup.
    const {runScenario} = await import('../src/runner.ts')
    const {renderCellResults} = await import('../src/report.ts')

    const results: CellResult[] = []
    for (let rep = 1; rep <= cfg.reps; rep++) {
        const result = await runScenario({
            scenario: cfg.scenario,
            driver: cfg.driver,
            model: cfg.model,
            effort: cfg.effort,
            mode: cfg.mode,
            rep,
            workspaceRoot: cfg.workspaceRoot,
            headfulDaemonReadyTimeoutMs: cfg.headfulDaemonReadyTimeoutMs,
        })
        results.push(result)
    }

    if (cfg.json) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
    } else {
        const color = process.stdout.isTTY === true
        process.stdout.write(`${renderCellResults(results, {color})}\n`)
    }

    const allPassed = results.every((r) => r.success.passed && r.coverage.passed)
    process.exit(allPassed ? 0 : 1)
}

void main().catch((err: unknown) => {
    process.stderr.write(
        `vt-bootcamp: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
})
