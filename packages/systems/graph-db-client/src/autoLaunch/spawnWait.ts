import { spawn, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { SpanStatusCode, type Span } from '@opentelemetry/api'
import { DaemonLaunchTimeout, DaemonLockHeldError } from '../errors.ts'
import {
  createSpawnPollTimings,
  recordLastSpawnPollSleep,
  recordSpawnPollIteration,
  setSpawnPollTimingAttributes,
  type SpawnPollTimings,
} from './pollTimings.ts'
import {
  REUSE_PROBE_AFTER_LOCK_HELD_MS,
  probeHealth,
  sleep,
  unrefIfSupported,
  waitForHealthyPort,
} from './probes.ts'
import { type CommandSpec } from './runtime.ts'
import {
  boundedAppend,
  launchTimeoutMessage,
  parseAlreadyRunningPid,
} from './spawnOutput.ts'
import { type EnsureDaemonResult } from './types.ts'
import { readPortFile } from '../portDiscovery.ts'

type SpawnState = { error: NodeJS.ErrnoException | null }
type SpawnOutputState = {
  stderr: string
  alreadyRunningPid: number | null
}
type SpawnProbeResult = {
  port: number | null
  healthy: boolean
  readPortFileMs: number
  probeHealthMs: number
}

export async function waitForSpawnedDaemon(
  command: CommandSpec,
  resolvedVault: string,
  timeoutMs: number,
  spawnSpan: Span,
): Promise<EnsureDaemonResult> {
  const { spawnedPid, spawnState, outputState } = startDetachedDaemon(
    command,
    spawnSpan,
  )
  const deadline = Date.now() + timeoutMs
  const pollTimings = createSpawnPollTimings()
  let backoff = 100
  spawnSpan.setAttribute('poll.backoff.initialMs', backoff)

  while (Date.now() < deadline) {
    throwIfSpawnFailed(spawnState, spawnSpan, pollTimings)

    const probe = await readSpawnProbe(resolvedVault, spawnSpan, pollTimings)
    recordSpawnPollProbe(pollTimings, probe)

    if (probe.port !== null && probe.healthy) {
      return completeHealthySpawn(spawnSpan, pollTimings, {
        port: probe.port,
        spawnedPid,
      })
    }

    if (outputState.alreadyRunningPid !== null) {
      return await resolveAlreadyRunningSpawn(
        resolvedVault,
        outputState.alreadyRunningPid,
        spawnSpan,
        pollTimings,
      )
    }

    const nextBackoff = await sleepUntilNextSpawnPoll(
      deadline,
      backoff,
      pollTimings,
    )
    if (nextBackoff === null) break
    backoff = nextBackoff
  }

  throwIfSpawnFailed(spawnState, spawnSpan, pollTimings)
  throwLaunchTimeout(timeoutMs, resolvedVault, outputState.stderr, {
    span: spawnSpan,
    timings: pollTimings,
  })
}

function startDetachedDaemon(
  command: CommandSpec,
  spawnSpan: Span,
): {
  spawnedPid: number | null
  spawnState: SpawnState
  outputState: SpawnOutputState
} {
  const child: ChildProcess = spawn(command.cmd, command.args, {
    detached: true,
    env: command.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.unref()
  unrefIfSupported(child.stderr)

  const spawnedPid = child.pid ?? null
  spawnSpan.setAttribute('pid', spawnedPid ?? 0)

  const spawnState: SpawnState = { error: null }
  const outputState: SpawnOutputState = { stderr: '', alreadyRunningPid: null }
  child.on('error', (err) => {
    spawnState.error = err as NodeJS.ErrnoException
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    outputState.stderr = boundedAppend(outputState.stderr, chunk, 4000)
    if (outputState.alreadyRunningPid === null) {
      outputState.alreadyRunningPid = parseAlreadyRunningPid(
        outputState.stderr,
      )
    }
  })

  return { spawnedPid, spawnState, outputState }
}

async function readSpawnProbe(
  resolvedVault: string,
  span: Span,
  timings: SpawnPollTimings,
): Promise<SpawnProbeResult> {
  try {
    const readPortFileStartMs = performance.now()
    const port = await readPortFile(resolvedVault)
    const readPortFileMs = performance.now() - readPortFileStartMs

    if (port === null) {
      return { port, healthy: false, readPortFileMs, probeHealthMs: 0 }
    }

    const probeHealthStartMs = performance.now()
    const healthy = await probeHealth(resolvedVault, port)
    const probeHealthMs = performance.now() - probeHealthStartMs
    return { port, healthy, readPortFileMs, probeHealthMs }
  } catch (err) {
    throwSpanError(err, span, timings, String(err))
  }
}

function recordSpawnPollProbe(
  timings: SpawnPollTimings,
  probe: SpawnProbeResult,
): void {
  recordSpawnPollIteration(timings, {
    readPortFileMs: probe.readPortFileMs,
    probeHealthMs: probe.probeHealthMs,
    sleepMs: 0,
    portFound: probe.port !== null,
    healthy: probe.healthy,
  })
}

function completeHealthySpawn(
  span: Span,
  timings: SpawnPollTimings,
  result: { port: number; spawnedPid: number | null },
): EnsureDaemonResult {
  span.setAttribute('port', result.port)
  setSpawnPollTimingAttributes(span, timings)
  span.end()
  return { port: result.port, pid: result.spawnedPid, launched: true }
}

async function resolveAlreadyRunningSpawn(
  resolvedVault: string,
  alreadyRunningPid: number,
  span: Span,
  timings: SpawnPollTimings,
): Promise<EnsureDaemonResult> {
  let port: number | null
  try {
    port = await waitForHealthyPort(resolvedVault, {
      initialBackoffMs: 100,
      maxBackoffMs: 100,
      timeoutMs: REUSE_PROBE_AFTER_LOCK_HELD_MS,
    })
  } catch (err) {
    throwSpanError(err, span, timings, String(err))
  }

  if (port !== null) {
    span.setAttribute('port', port)
    span.setAttribute('alreadyRunningPid', alreadyRunningPid)
    setSpawnPollTimingAttributes(span, timings)
    span.end()
    return { port, pid: alreadyRunningPid, launched: false }
  }

  const err = new DaemonLockHeldError(resolvedVault, alreadyRunningPid)
  throwSpanError(err, span, timings, err.message)
}

async function sleepUntilNextSpawnPoll(
  deadline: number,
  backoff: number,
  timings: SpawnPollTimings,
): Promise<number | null> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return null

  const sleepMs = Math.min(backoff, remaining)
  const sleepStartMs = performance.now()
  await sleep(sleepMs)
  recordLastSpawnPollSleep(timings, performance.now() - sleepStartMs)
  return Math.min(backoff * 2, 100)
}

function throwIfSpawnFailed(
  state: SpawnState,
  span: Span,
  timings: SpawnPollTimings,
): void {
  if (!state.error) return
  throwSpanError(state.error, span, timings, state.error.message)
}

function throwLaunchTimeout(
  timeoutMs: number,
  resolvedVault: string,
  stderr: string,
  context: { span: Span; timings: SpawnPollTimings },
): never {
  const err = new DaemonLaunchTimeout(
    launchTimeoutMessage(timeoutMs, resolvedVault, stderr),
  )
  throwSpanError(err, context.span, context.timings, err.message)
}

function throwSpanError(
  err: unknown,
  span: Span,
  timings: SpawnPollTimings,
  message: string,
): never {
  setSpawnPollTimingAttributes(span, timings)
  span.setStatus({ code: SpanStatusCode.ERROR, message })
  span.end()
  throw err
}
