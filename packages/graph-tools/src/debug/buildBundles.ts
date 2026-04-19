/**
 * Helper: read a live harness run dir and build FlowBundle + judge prompt per flow.
 * Used by INT-1 judge orchestration.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

import { loadFlowDefinition, FLOW_IDS, type FlowId } from './flows/index'
import { buildJudgePrompt, type FlowBundle, type RunSummary, type StepOutputSummary } from './judge'
import type { RunStepOutput, RunResult } from '../commands/run'

export type BuiltBundle = {
  flowId: FlowId
  bundle: FlowBundle
  prompt: string
  bundleDir: string
}

function extractConsole(consoleData: unknown): { errors: string[]; warnings: string[] } {
  if (!Array.isArray(consoleData)) return { errors: [], warnings: [] }
  const errors: string[] = []
  const warnings: string[] = []
  for (const entry of consoleData as Array<{ level: string; args: unknown[] }>) {
    const msg = entry.args?.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') ?? ''
    if (entry.level === 'error') errors.push(msg.slice(0, 200))
    else if (entry.level === 'warn') warnings.push(msg.slice(0, 150))
  }
  return { errors: errors.slice(0, 5), warnings: warnings.slice(0, 3) }
}

function extractState(stateData: unknown): { nodeCount?: number; rootsLoaded?: string[] } {
  if (typeof stateData !== 'object' || stateData === null) return {}
  const s = stateData as Record<string, unknown>
  const graph = s.graph as Record<string, unknown> | undefined
  const roots = s.roots as Record<string, unknown> | undefined
  const nodeCount = typeof graph?.nodes === 'object' && graph.nodes !== null
    ? Object.keys(graph.nodes as object).length
    : undefined
  const loaded = roots?.loaded
  const rootsLoaded = Array.isArray(loaded) ? (loaded as string[]) : undefined
  return { nodeCount, rootsLoaded }
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function buildRunSummary(runDir: string, runIndex: number, stepCount: number): Promise<RunSummary> {
  const cliResult = await readJsonSafe(path.join(runDir, 'cli-result.json')) as { stdout: string } | null
  let outputs: RunStepOutput[] = []
  let pass = false

  if (cliResult?.stdout) {
    try {
      const parsed = JSON.parse(cliResult.stdout) as { ok: boolean; result?: RunResult }
      if (parsed.ok && parsed.result) {
        outputs = parsed.result.bundle.outputs as RunStepOutput[]
        pass = outputs.every(o => o.ok)
      }
    } catch {
      // ignore
    }
  }

  const stepOutputs: StepOutputSummary[] = []
  for (let i = 0; i < Math.max(outputs.length, stepCount); i += 1) {
    const output = outputs[i]
    if (!output) break

    const consolePath = path.join(runDir, `step-${String(i + 1).padStart(2, '0')}.console.json`)
    const statePath = path.join(runDir, `step-${String(i + 1).padStart(2, '0')}.state.json`)
    const consoleData = await readJsonSafe(consolePath)
    const stateData = await readJsonSafe(statePath)
    const { errors: consoleErrors, warnings: consoleWarnings } = extractConsole(consoleData)
    const { nodeCount, rootsLoaded } = extractState(stateData)

    stepOutputs.push({
      stepIndex: i,
      step: output.step,
      ok: output.ok,
      error: output.error,
      observationErrors: output.observationErrors,
      consoleErrors,
      consoleWarnings,
      stateGraphNodeCount: nodeCount,
      stateRootsLoaded: rootsLoaded,
    })
  }

  return { runIndex, pass, stepOutputs }
}

async function buildFlowBundle(flowId: FlowId, flowDir: string): Promise<BuiltBundle> {
  const definition = await loadFlowDefinition(flowId)
  const scoreboardRow = await readJsonSafe(path.join(flowDir, 'scoreboard-row.json')) as FlowBundle['scoreboardRow'] | null

  const runSummaries: RunSummary[] = []
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    const runDir = path.join(flowDir, `run-${String(runIndex).padStart(2, '0')}`)
    try {
      const summary = await buildRunSummary(runDir, runIndex, definition.steps.length)
      runSummaries.push(summary)
    } catch {
      // missing run dir — skip
    }
  }

  const bundle: FlowBundle = {
    flowId,
    title: definition.title,
    intent: definition.intent,
    judgeFocus: definition.judgeFocus,
    steps: definition.steps,
    scoreboardRow: scoreboardRow ?? { pass: false, reason: 'unknown', runs: [] },
    runSummaries,
  }

  const prompt = buildJudgePrompt(bundle)
  return { flowId, bundle, prompt, bundleDir: flowDir }
}

async function main(): Promise<void> {
  const flowsDir = process.argv[2]
  const outDir = process.argv[3] ?? '/tmp/vt-debug/judge-prompts'

  if (!flowsDir) {
    process.stderr.write('usage: buildBundles.ts <flowsRunDir> [outDir]\n')
    process.exit(1)
  }

  await fs.mkdir(outDir, { recursive: true })

  const timestamp = (await fs.readdir(flowsDir))
    .filter(d => d.startsWith('F1-'))
    .sort()
    .at(-1)
    ?.replace('F1-', '') ?? ''

  const results: BuiltBundle[] = []

  for (const flowId of FLOW_IDS) {
    const flowDir = path.join(flowsDir, `${flowId}-${timestamp}`)
    const built = await buildFlowBundle(flowId, flowDir)
    results.push(built)
    const promptPath = path.join(outDir, `judge-prompt-${flowId}.txt`)
    await fs.writeFile(promptPath, built.prompt, 'utf8')
    process.stdout.write(`${flowId}: prompt written to ${promptPath}\n`)
  }

  const summary = results.map(r => ({ flowId: r.flowId, stepCount: r.bundle.steps.length, bundleDir: r.bundleDir }))
  process.stdout.write(`\nSummary: ${JSON.stringify(summary, null, 2)}\n`)
}

main().catch(e => {
  process.stderr.write(String(e) + '\n')
  process.exit(1)
})
