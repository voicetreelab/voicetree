#!/usr/bin/env npx tsx

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { filterLive, pickInstance, readInstancesDir, type DebugInstance } from '../src/debug/discover'
import {
  FLOW_IDS,
  deriveFlowRuntimeContext,
  loadAllFlowDefinitions,
  loadFlowDefinition,
  resolveFlowDefinition,
  type FlowDefinition,
  type FlowId,
} from '../src/debug/flows/index'
import { err, ok } from '../src/debug/Response'
import type { Response } from '../src/debug/Response'
import {
  buildScoreboardRow,
  createScoreboard,
  evaluateRunResult,
  type FlowAttempt,
  type FlowScoreboard,
} from '../src/debug/scoreboard'
import type { RunResult } from '../src/commands/run'
import { createLiveTransport } from '../src/liveTransport'

const DEFAULT_OUT_DIR = '/tmp/vt-debug/flows'
const DEFAULT_FIXTURE_OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/int1-baseline.json',
)
const OBSERVATION_FLAGS = ['--screenshot-each', '--console-each', '--state-each', '--stop-on-error=false']
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..')
const VT_DEBUG_BIN = path.resolve(SCRIPT_DIR, './vt-debug.ts')

type RunnerOptions = {
  outDir: string
  fixtureOut: string
  port?: number
  pid?: number
  vault?: string
}

type ParsedArgs =
  | { command: 'list'; options: RunnerOptions }
  | { command: 'run-all'; options: RunnerOptions }
  | { command: 'run'; flowId: FlowId; options: RunnerOptions }

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}

type RunAllResult = {
  scoreboard: FlowScoreboard
  scoreboardPath: string
  fixturePath: string
}

function usage(message?: string): Response<never> {
  return err(
    'flows',
    message ?? 'usage: vt-debug-flows <list|run-all|run <F1..F8>> [--out <dir>] [--fixture-out <file>] [--port <n> | --pid <n> | --vault <path>]',
  )
}

function readFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseNumber(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(readFlagValue(flag, value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires an integer`)
  }
  return parsed
}

function isFlowId(value: string): value is FlowId {
  return FLOW_IDS.includes(value as FlowId)
}

function parseArgs(argv: string[]): ParsedArgs | Response<never> {
  const [command, maybeFlowId, ...rest] = argv

  if (!command) {
    return usage('missing command')
  }

  let outDir = DEFAULT_OUT_DIR
  let fixtureOut = DEFAULT_FIXTURE_OUT
  let port: number | undefined
  let pid: number | undefined
  let vault: string | undefined

  const flagArgs = command === 'run' ? rest : [maybeFlowId, ...rest].filter(Boolean) as string[]

  try {
    for (let index = 0; index < flagArgs.length; index += 1) {
      const arg = flagArgs[index]

      if (arg === '--out') {
        outDir = path.resolve(readFlagValue('--out', flagArgs[index + 1]))
        index += 1
        continue
      }

      if (arg.startsWith('--out=')) {
        outDir = path.resolve(readFlagValue('--out', arg.slice('--out='.length)))
        continue
      }

      if (arg === '--fixture-out') {
        fixtureOut = path.resolve(readFlagValue('--fixture-out', flagArgs[index + 1]))
        index += 1
        continue
      }

      if (arg.startsWith('--fixture-out=')) {
        fixtureOut = path.resolve(readFlagValue('--fixture-out', arg.slice('--fixture-out='.length)))
        continue
      }

      if (arg === '--port') {
        port = parseNumber('--port', flagArgs[index + 1])
        index += 1
        continue
      }

      if (arg.startsWith('--port=')) {
        port = parseNumber('--port', arg.slice('--port='.length))
        continue
      }

      if (arg === '--pid') {
        pid = parseNumber('--pid', flagArgs[index + 1])
        index += 1
        continue
      }

      if (arg.startsWith('--pid=')) {
        pid = parseNumber('--pid', arg.slice('--pid='.length))
        continue
      }

      if (arg === '--vault') {
        vault = readFlagValue('--vault', flagArgs[index + 1])
        index += 1
        continue
      }

      if (arg.startsWith('--vault=')) {
        vault = readFlagValue('--vault', arg.slice('--vault='.length))
        continue
      }

      if (arg.startsWith('--')) {
        return usage(`unknown argument: ${arg}`)
      }
    }
  } catch (error) {
    return usage(String(error))
  }

  const options: RunnerOptions = { outDir, fixtureOut, port, pid, vault }

  if (command === 'list') {
    return { command, options }
  }

  if (command === 'run-all') {
    return { command, options }
  }

  if (command === 'run') {
    if (!maybeFlowId || !isFlowId(maybeFlowId)) {
      return usage(`run requires a flow id (${FLOW_IDS.join(', ')})`)
    }
    return { command, flowId: maybeFlowId, options }
  }

  return usage(`unknown command: ${command}`)
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function execFileResult(args: readonly string[]): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      args,
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : 0

        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          exitCode,
          ...(error ? { error: error.message } : {}),
        })
      },
    )
  })
}

async function resolveTargetInstance(options: RunnerOptions): Promise<DebugInstance | Response<never>> {
  const all = await readInstancesDir()
  const live = await filterLive(all)
  const pick = pickInstance(live, {
    port: options.port,
    pid: options.pid,
    vault: options.vault,
  })

  if (!pick.ok) {
    return err('flows', pick.message, pick.hint, 2)
  }

  return pick.instance
}

function flowTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '')
}

function childRunArgs(specPath: string, outDir: string, instance: DebugInstance): string[] {
  return [
    '--import',
    'tsx',
    VT_DEBUG_BIN,
    'run',
    specPath,
    ...OBSERVATION_FLAGS,
    '--out',
    outDir,
    '--pid',
    String(instance.pid),
  ]
}

function parseRunResponse(stdout: string): Response<RunResult> | null {
  if (stdout.trim() === '') return null
  try {
    return JSON.parse(stdout) as Response<RunResult>
  } catch {
    return null
  }
}

async function executeFlowAttempt(
  definition: FlowDefinition,
  flowDir: string,
  runIndex: number,
  instance: DebugInstance,
): Promise<FlowAttempt> {
  const runDir = path.join(flowDir, `run-${String(runIndex).padStart(2, '0')}`)
  await fs.mkdir(runDir, { recursive: true })

  try {
    const transport = createLiveTransport(instance.mcpPort)
    const state = await transport.getLiveState()
    const context = deriveFlowRuntimeContext(state)
    const resolved = resolveFlowDefinition(definition, context)
    const specPath = path.join(runDir, 'flow.json')
    await writeJson(specPath, resolved)

    const execResult = await execFileResult(childRunArgs(specPath, runDir, instance))
    await writeJson(path.join(runDir, 'cli-result.json'), execResult)

    const parsed = parseRunResponse(execResult.stdout)
    if (!parsed) {
      return {
        pass: false,
        reason: execResult.stderr.trim() || execResult.error || 'vt-debug run returned non-JSON output',
        bundleDir: runDir,
      }
    }

    const attempt = evaluateRunResult(parsed)
    return {
      ...attempt,
      bundleDir: attempt.bundleDir || runDir,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeJson(path.join(runDir, 'resolution-error.json'), { error: message })
    return {
      pass: false,
      reason: message,
      bundleDir: runDir,
    }
  }
}

async function executeFlow(
  definition: FlowDefinition,
  options: RunnerOptions,
  instance: DebugInstance,
  timestamp: string,
): Promise<{ row: ReturnType<typeof buildScoreboardRow>; bundleDir: string }> {
  const flowDir = path.join(options.outDir, `${definition.flow}-${timestamp}`)
  await fs.mkdir(flowDir, { recursive: true })
  await writeJson(path.join(flowDir, 'flow-definition.json'), definition)

  const attempts: FlowAttempt[] = []
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    attempts.push(await executeFlowAttempt(definition, flowDir, runIndex, instance))
  }

  const row = buildScoreboardRow(definition.flow, attempts)
  await writeJson(path.join(flowDir, 'scoreboard-row.json'), row)

  return { row, bundleDir: flowDir }
}

async function runFlowSet(
  definitions: readonly FlowDefinition[],
  options: RunnerOptions,
  instance: DebugInstance,
): Promise<RunAllResult> {
  await fs.mkdir(options.outDir, { recursive: true })

  const timestamp = flowTimestamp()
  const rows: ReturnType<typeof buildScoreboardRow>[] = []
  const bundleDirs: Record<string, string> = {}

  for (const definition of definitions) {
    const result = await executeFlow(definition, options, instance, timestamp)
    rows.push(result.row)
    bundleDirs[definition.flow] = result.bundleDir
  }

  const scoreboard = createScoreboard(rows, bundleDirs)
  const scoreboardPath = path.join(options.outDir, `scoreboard-${timestamp}.json`)
  await writeJson(scoreboardPath, scoreboard)
  await writeJson(options.fixtureOut, scoreboard)

  return {
    scoreboard,
    scoreboardPath,
    fixturePath: options.fixtureOut,
  }
}

async function handler(argv: string[]): Promise<Response<unknown>> {
  const parsed = parseArgs(argv)
  if ('ok' in parsed && parsed.ok === false) {
    return parsed
  }

  if (parsed.command === 'list') {
    const flows = await loadAllFlowDefinitions()
    return ok('flows', {
      flowIds: FLOW_IDS,
      flows: flows.map(flow => ({
        flow: flow.flow,
        title: flow.title,
        likelyStatusToday: flow.likelyStatusToday,
        stepCount: flow.steps.length,
      })),
    })
  }

  const instance = await resolveTargetInstance(parsed.options)
  if ('ok' in instance && instance.ok === false) {
    return instance
  }

  if (parsed.command === 'run') {
    const definition = await loadFlowDefinition(parsed.flowId)
    const result = await runFlowSet([definition], parsed.options, instance)
    return ok('flows', result)
  }

  const definitions = await loadAllFlowDefinitions()
  const result = await runFlowSet(definitions, parsed.options, instance)
  return ok('flows', result)
}

const result = await handler(process.argv.slice(2))
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(result.ok ? 0 : result.exitCode ?? 1)
