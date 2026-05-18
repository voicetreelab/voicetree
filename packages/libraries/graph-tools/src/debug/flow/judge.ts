import type { StepSpec } from './stepShape'

export interface StepOutputSummary {
  readonly stepIndex: number
  readonly step: StepSpec
  readonly ok: boolean
  readonly error?: string
  readonly observationErrors?: string[]
  readonly screenshotPath?: string
  readonly stateGraphNodeCount?: number
  readonly stateRootsLoaded?: string[]
  readonly domProbes?: Readonly<Record<string, unknown>>
  readonly consoleErrors?: string[]
  readonly consoleWarnings?: string[]
}

export interface RunSummary {
  readonly runIndex: number
  readonly pass: boolean
  readonly stepOutputs: readonly StepOutputSummary[]
}

export interface FlowBundle {
  readonly flowId: string
  readonly title: string
  readonly intent: string
  readonly judgeFocus: readonly string[]
  readonly steps: readonly StepSpec[]
  readonly scoreboardRow: {
    readonly pass: boolean
    readonly reason: string
    readonly runs: readonly boolean[]
  }
  readonly runSummaries: readonly RunSummary[]
}

export interface JudgeStepVerdict {
  readonly step: number
  readonly pass: boolean
  readonly reason: string
}

export interface JudgeVerdict {
  readonly pass: boolean
  readonly per_step: readonly JudgeStepVerdict[]
  readonly overall_reason: string
}

export function buildJudgePrompt(bundle: FlowBundle): string {
  const lines: string[] = []

  lines.push('You are a semantic judge for VoiceTree UI automation flows.')
  lines.push(
    'Your job: determine whether this flow passed FOR THE RIGHT SEMANTIC REASONS — not just mechanically.',
  )
  lines.push(
    'A mechanical "all steps ok" is NOT sufficient if the judge focus points are not satisfied.',
  )
  lines.push(
    'A mechanical failure (timeout, error) IS a semantic failure unless there is clear evidence the UI goal was met anyway.',
  )
  lines.push('')
  lines.push(`## Flow ${bundle.flowId}: ${bundle.title}`)
  lines.push(`**Intent:** ${bundle.intent}`)
  lines.push('')
  lines.push('## Judge Focus Points (what semantic success looks like)')
  for (const focus of bundle.judgeFocus) {
    lines.push(`- ${focus}`)
  }
  lines.push('')
  lines.push(`## Steps (${bundle.steps.length} total)`)
  for (let i = 0; i < bundle.steps.length; i += 1) {
    lines.push(`Step ${i + 1}: ${JSON.stringify(bundle.steps[i])}`)
  }
  lines.push('')
  lines.push('## Step screenshots (read via file path — you have Read tool access)')
  let hasScreenshots = false
  for (const run of bundle.runSummaries) {
    const screenshotSteps = run.stepOutputs.filter(output => output.screenshotPath !== undefined)
    if (screenshotSteps.length === 0) continue
    hasScreenshots = true
    lines.push(`### Run ${run.runIndex}`)
    for (const output of screenshotSteps) {
      lines.push(`step-${String(output.stepIndex + 1).padStart(2, '0')}: ${output.screenshotPath}`)
    }
  }
  if (!hasScreenshots) {
    lines.push('(none captured)')
  }
  lines.push('')
  lines.push('## Mechanical Result')
  const overallLabel = bundle.scoreboardRow.pass ? 'PASS' : 'FAIL'
  lines.push(`Overall: ${overallLabel} — ${bundle.scoreboardRow.reason}`)
  const runLabels = bundle.scoreboardRow.runs
    .map((r, i) => `run-${i + 1}: ${r ? 'PASS' : 'FAIL'}`)
    .join(', ')
  lines.push(`Runs: ${runLabels}`)
  lines.push('')
  lines.push('## Run Evidence')

  for (const run of bundle.runSummaries) {
    const runLabel = run.pass ? 'PASS' : 'FAIL'
    lines.push(`### Run ${run.runIndex} (${runLabel})`)
    for (const output of run.stepOutputs) {
      const stepLabel = output.ok ? 'ok' : `FAILED: ${output.error ?? 'unknown'}`
      lines.push(`  Step ${output.stepIndex + 1}: ${stepLabel}`)

      if ((output.observationErrors?.length ?? 0) > 0) {
        lines.push(`    Observation errors: ${output.observationErrors?.join('; ')}`)
      }

      if ((output.consoleErrors?.length ?? 0) > 0) {
        lines.push(`    Console errors: ${output.consoleErrors?.slice(0, 3).join(' | ')}`)
      }

      if ((output.consoleWarnings?.length ?? 0) > 0) {
        lines.push(`    Console warnings: ${output.consoleWarnings?.slice(0, 2).join(' | ')}`)
      }

      if (output.stateRootsLoaded !== undefined) {
        lines.push(`    State: roots.loaded count=${output.stateRootsLoaded.length}`)
      }

      if (output.stateGraphNodeCount !== undefined) {
        lines.push(`    State: graph.nodes count=${output.stateGraphNodeCount}`)
      }

      if (output.domProbes !== undefined) {
        lines.push('    Dom probes:')
        for (const line of JSON.stringify(output.domProbes, null, 2).split('\n')) {
          lines.push(`      ${line}`)
        }
      }
    }
  }

  lines.push('')
  lines.push('## Your Verdict')
  lines.push(
    `Respond with ONLY valid JSON — no markdown fences, no prose outside the JSON object.`,
  )
  lines.push(`The "per_step" array must have exactly ${bundle.steps.length} entries.`)
  lines.push('')
  lines.push('Schema:')
  lines.push('{')
  lines.push('  "pass": boolean,')
  lines.push('  "per_step": [')
  lines.push('    {"step": 1, "pass": boolean, "reason": "one sentence"},')
  lines.push('    ...')
  lines.push('  ],')
  lines.push('  "overall_reason": "one paragraph — semantic assessment, not a mechanical replay"')
  lines.push('}')

  return lines.join('\n')
}

export function parseJudgeResponse(text: string): JudgeVerdict {
  const trimmed = text.trim()
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error(`no JSON object found in judge response: ${trimmed.slice(0, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch (e) {
    throw new Error(`invalid JSON in judge response: ${match[0].slice(0, 200)}`)
  }

  if (!isJudgeVerdict(parsed)) {
    throw new Error(`judge response does not match JudgeVerdict schema: ${JSON.stringify(parsed).slice(0, 300)}`)
  }

  return parsed
}

function isJudgeStepVerdict(value: unknown): value is JudgeStepVerdict {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.step === 'number' &&
    typeof v.pass === 'boolean' &&
    typeof v.reason === 'string'
  )
}

function isJudgeVerdict(value: unknown): value is JudgeVerdict {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.pass === 'boolean' &&
    Array.isArray(v.per_step) &&
    v.per_step.every(isJudgeStepVerdict) &&
    typeof v.overall_reason === 'string'
  )
}
