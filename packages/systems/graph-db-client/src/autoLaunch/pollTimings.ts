import type { Span } from '@opentelemetry/api'

export type SpawnPollTimings = {
  iterations: Array<{
    readPortFileMs: number
    probeHealthMs: number
    sleepMs: number
    portFound: boolean
    healthy: boolean
  }>
}

export function createSpawnPollTimings(): SpawnPollTimings {
  return { iterations: [] }
}

export function recordSpawnPollIteration(
  timings: SpawnPollTimings,
  iteration: SpawnPollTimings['iterations'][number],
): void {
  timings.iterations.push(iteration)
}

export function recordLastSpawnPollSleep(
  timings: SpawnPollTimings,
  sleepMs: number,
): void {
  const lastIteration = timings.iterations.at(-1)
  if (!lastIteration) return
  lastIteration.sleepMs = sleepMs
}

export function setSpawnPollTimingAttributes(
  span: Span,
  timings: SpawnPollTimings,
): void {
  const readPortFileMs = timings.iterations.map((entry) => entry.readPortFileMs)
  const probeHealthMs = timings.iterations.map((entry) => entry.probeHealthMs)
  const sleepMs = timings.iterations.map((entry) => entry.sleepMs)
  span.setAttribute('poll.iterations', timings.iterations.length)
  span.setAttribute('poll.readPortFile.ms', readPortFileMs)
  span.setAttribute('poll.probeHealth.ms', probeHealthMs)
  span.setAttribute('poll.sleep.ms', sleepMs)
  span.setAttribute(
    'poll.portFound',
    timings.iterations.map((entry) => entry.portFound),
  )
  span.setAttribute(
    'poll.healthy',
    timings.iterations.map((entry) => entry.healthy),
  )
  span.setAttribute('poll.readPortFile.totalMs', sumNumbers(readPortFileMs))
  span.setAttribute('poll.probeHealth.totalMs', sumNumbers(probeHealthMs))
  span.setAttribute('poll.sleep.totalMs', sumNumbers(sleepMs))
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
