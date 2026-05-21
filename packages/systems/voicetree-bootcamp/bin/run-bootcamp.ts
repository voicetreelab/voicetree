#!/usr/bin/env tsx
/**
 * Phase 1 CLI entrypoint. Runs one (scenario × model) cell and prints a
 * human-readable report to stdout.
 *
 * Usage:
 *   vt-bootcamp --scenario S9 --model sonnet --vt-bin /abs/path/to/vt
 *
 * Phase 3 will replace this with a matrix runner.
 */
import * as path from 'node:path'
import {runScenario, s9AtomicCreate} from '../src/index.ts'
import type {ScenarioSpec} from '../src/types.ts'

const SCENARIOS: Readonly<Record<string, ScenarioSpec>> = {
    S9: s9AtomicCreate,
}

type Args = {
    readonly scenarioId: string
    readonly model: string
    readonly effort: 'low' | 'medium' | 'high'
    readonly realVtBin: string
}

function parseArgs(argv: readonly string[]): Args {
    let scenarioId = ''
    let model = 'sonnet'
    let effort: 'low' | 'medium' | 'high' = 'low'
    let realVtBin = ''

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const next = argv[i + 1]
        switch (arg) {
            case '--scenario':
                scenarioId = requireValue(arg, next)
                i++
                break
            case '--model':
                model = requireValue(arg, next)
                i++
                break
            case '--effort':
                effort = parseEffort(requireValue(arg, next))
                i++
                break
            case '--vt-bin':
                realVtBin = path.resolve(requireValue(arg, next))
                i++
                break
            default:
                fail(`unknown arg: ${arg}`)
        }
    }

    if (!scenarioId) fail('--scenario is required')
    if (!realVtBin) fail('--vt-bin is required (absolute path to the real `vt` binary)')

    return {scenarioId, model, effort, realVtBin}
}

function requireValue(flag: string, value: string | undefined): string {
    if (!value || value.startsWith('--')) fail(`${flag} requires a value`)
    return value
}

function parseEffort(value: string): 'low' | 'medium' | 'high' {
    if (value === 'low' || value === 'medium' || value === 'high') return value
    fail(`--effort must be one of: low, medium, high (got: ${value})`)
}

function fail(message: string): never {
    console.error(`vt-bootcamp: ${message}`)
    console.error('Usage: vt-bootcamp --scenario <id> --model <name> [--effort low|medium|high] --vt-bin <path>')
    process.exit(2)
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    const scenario = SCENARIOS[args.scenarioId]
    if (!scenario) fail(`unknown scenario: ${args.scenarioId} (available: ${Object.keys(SCENARIOS).join(', ')})`)

    console.log(`Running ${scenario.id} (${scenario.name}) on ${args.model} (effort=${args.effort})…\n`)

    const result = await runScenario({
        scenario,
        model: args.model,
        effort: args.effort,
        realVtBin: args.realVtBin,
    })

    console.log(`Score: ${result.meanScore.toFixed(2)}`)
    console.log(`Success criteria: ${result.success.passed ? 'PASS' : 'FAIL'} — ${result.success.detail}`)
    console.log('\nPer-command outcomes:')
    for (const attempt of result.attempts) {
        console.log(`  ${attempt.expected.verb.padEnd(30)} ${attempt.outcome}`)
    }
    console.log(`\nArtifacts:`)
    console.log(`  shim log dir: ${result.shimLogDir}`)
    console.log(`  transcript:   ${result.transcriptPath}`)

    process.exit(result.meanScore >= 0.85 && result.success.passed ? 0 : 1)
}

void main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack : String(err))
    process.exit(1)
})
