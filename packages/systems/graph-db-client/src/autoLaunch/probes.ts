import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { DaemonUnreachableError } from '../errors.ts'
import { discoverPort, readPortFile } from '../portDiscovery.ts'

export const REUSE_PROBE_AFTER_LOCK_HELD_MS = 2000

type HealthyPortProbeDeps = {
  now: () => number
  probeHealth: (vault: string, port: number) => Promise<boolean>
  readPortFile: (vault: string) => Promise<number | null>
  sleep: (ms: number) => Promise<void>
}

const tracer = trace.getTracer('vt-daemon-client')

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export function unrefIfSupported(value: unknown): void {
  if (!isRecord(value) || typeof value.unref !== 'function') return
  value.unref()
}

export async function readAliveLockHolder(vault: string): Promise<number | null> {
  try {
    const raw = await readFile(join(vault, '.voicetree', 'graphd.lock'), 'utf8')
    const pid = Number(raw.trim())
    return isProcessAlive(pid) ? pid : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function probeHealth(vault: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    if (!response.ok) {
      return false
    }

    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.vault !== 'string') {
      return false
    }

    return body.vault === resolve(vault)
  } catch {
    return false
  }
}

export async function waitForHealthyPort(
  vault: string,
  opts: {
    initialBackoffMs: number
    maxBackoffMs: number
    timeoutMs: number
  },
  deps: HealthyPortProbeDeps = {
    now: nowMs,
    probeHealth,
    readPortFile,
    sleep,
  },
): Promise<number | null> {
  const deadline = deps.now() + opts.timeoutMs
  let backoffMs = opts.initialBackoffMs

  while (deps.now() < deadline) {
    const port = await deps.readPortFile(vault)
    if (port !== null && (await deps.probeHealth(vault, port))) {
      return port
    }

    const remainingMs = deadline - deps.now()
    if (remainingMs <= 0) break
    await deps.sleep(Math.min(backoffMs, remainingMs))
    backoffMs = nextBackoffMs(backoffMs, opts.maxBackoffMs)
  }

  return null
}

export async function traceReuseDiscoverPort(vault: string): Promise<number> {
  return await tracer.startActiveSpan(
    'daemon.reuse-probe.discover-port',
    async (span) => {
      try {
        const port = await discoverPort(vault, { timeoutMs: 500 })
        span.setAttribute('port', port)
        return port
      } catch (err) {
        if (!(err instanceof DaemonUnreachableError)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: String(err),
          })
        }
        throw err
      } finally {
        span.end()
      }
    },
  )
}

export async function traceReuseProbeHealth(
  vault: string,
  port: number,
): Promise<boolean> {
  return await tracer.startActiveSpan(
    'daemon.reuse-probe.probe-health',
    async (span) => {
      span.setAttribute('port', port)
      try {
        const healthy = await probeHealth(vault, port)
        span.setAttribute('healthy', healthy)
        return healthy
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(err),
        })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

function nowMs(): number {
  return Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

function nextBackoffMs(backoffMs: number, maxBackoffMs: number): number {
  return Math.min(backoffMs * 2, maxBackoffMs)
}
