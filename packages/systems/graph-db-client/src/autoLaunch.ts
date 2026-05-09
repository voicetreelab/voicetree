import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
} from './errors.ts'
import {
  createSpawnPollTimings,
  recordLastSpawnPollSleep,
  recordSpawnPollIteration,
  setSpawnPollTimingAttributes,
} from './autoLaunch/pollTimings.ts'
import {
  REUSE_PROBE_AFTER_LOCK_HELD_MS,
  probeHealth,
  readAliveLockHolder,
  sleep,
  traceReuseDiscoverPort,
  traceReuseProbeHealth,
  unrefIfSupported,
  waitForHealthyPort,
} from './autoLaunch/probes.ts'
import {
  resolveCommand,
  resolveDaemonRuntimeCommand,
} from './autoLaunch/runtime.ts'
import {
  boundedAppend,
  launchTimeoutMessage,
  parseAlreadyRunningPid,
} from './autoLaunch/spawnOutput.ts'
import { readPortFile } from './portDiscovery.ts'
import { initTracing } from './tracing.ts'

const tracer = trace.getTracer('vt-daemon-client')

let tracingInitialized = false
function ensureTracingInit(): void {
  if (tracingInitialized) return
  tracingInitialized = true
  initTracing('vt-daemon-client')
}

export interface EnsureDaemonResult {
  port: number
  pid: number | null
  launched: boolean
}

export { resolveDaemonRuntimeCommand }

export async function ensureDaemon(
  vault: string,
  opts?: { timeoutMs?: number; bin?: string },
): Promise<EnsureDaemonResult> {
  ensureTracingInit()

  return tracer.startActiveSpan('daemon.ensure', async (ensureSpan) => {
    const resolvedVault = resolve(vault)
    const timeoutMs = opts?.timeoutMs ?? 5000
    ensureSpan.setAttribute('vault', resolvedVault)
    ensureSpan.setAttribute('timeoutMs', timeoutMs)

    try {
      // 1. Reuse path: short-wait for existing port file, then /health-verify.
      const reuseResult = await tracer.startActiveSpan(
        'daemon.reuse-probe',
        async (reuseSpan) => {
          let existingPort: number | null = null
          try {
            existingPort = await traceReuseDiscoverPort(resolvedVault)
          } catch (err) {
            if (!(err instanceof DaemonUnreachableError)) {
              reuseSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(err),
              })
              reuseSpan.end()
              throw err
            }
          }
          if (
            existingPort !== null &&
            (await traceReuseProbeHealth(resolvedVault, existingPort))
          ) {
            reuseSpan.setAttribute('reused', true)
            reuseSpan.setAttribute('port', existingPort)
            reuseSpan.end()
            return {
              port: existingPort,
              pid: null,
              launched: false,
            } as EnsureDaemonResult
          }
          reuseSpan.setAttribute('reused', false)
          reuseSpan.end()
          return null
        },
      )

      if (reuseResult) {
        ensureSpan.setAttribute('reused', true)
        ensureSpan.end()
        return reuseResult
      }

      const lockHolderPid = await readAliveLockHolder(resolvedVault)
      if (lockHolderPid !== null) {
        const port = await waitForHealthyPort(resolvedVault, {
          initialBackoffMs: 100,
          maxBackoffMs: 100,
          timeoutMs: REUSE_PROBE_AFTER_LOCK_HELD_MS,
        })
        if (port !== null) {
          ensureSpan.setAttribute('reused', true)
          ensureSpan.setAttribute('lockHolderPid', lockHolderPid)
          ensureSpan.end()
          return {
            port,
            pid: lockHolderPid,
            launched: false,
          }
        }

        throw new DaemonLockHeldError(resolvedVault, lockHolderPid)
      }

      // 2. Resolve the runtime command.
      const { cmd, args, env } = tracer.startActiveSpan(
        'daemon.resolve-command',
        (resolveSpan) => {
          try {
            const result = resolveCommand(
              resolvedVault,
              process.env.VT_GRAPHD_BIN ?? opts?.bin,
            )
            resolveSpan.setAttribute('cmd', result.cmd)
            resolveSpan.end()
            return result
          } catch (err) {
            resolveSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(err),
            })
            resolveSpan.end()
            throw err
          }
        },
      )

      // 3. Spawn detached + unref'd and poll for readiness.
      return await tracer.startActiveSpan(
        'daemon.spawn-and-wait',
        async (spawnSpan) => {
          let child: ChildProcess = spawn(cmd, args, {
            detached: true,
            env,
            stdio: ['ignore', 'ignore', 'pipe'],
          })
          child.unref()
          unrefIfSupported(child.stderr)
          const spawnedPid = child.pid ?? null
          spawnSpan.setAttribute('pid', spawnedPid ?? 0)

          const spawnState: { error: NodeJS.ErrnoException | null } = {
            error: null,
          }
          let stderr = ''
          let alreadyRunningPid: number | null = null
          child.on('error', (err) => {
            spawnState.error = err as NodeJS.ErrnoException
          })
          child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr = boundedAppend(stderr, chunk, 4000)
            if (alreadyRunningPid === null) {
              alreadyRunningPid = parseAlreadyRunningPid(stderr)
            }
          })

          // Poll for port file + /health (lock-coalesces: whoever's port file lands first wins).
          const deadline = Date.now() + timeoutMs
          const pollTimings = createSpawnPollTimings()
          let backoff = 100
          spawnSpan.setAttribute('poll.backoff.initialMs', backoff)
          while (Date.now() < deadline) {
            if (spawnState.error) {
              setSpawnPollTimingAttributes(spawnSpan, pollTimings)
              spawnSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: spawnState.error.message,
              })
              spawnSpan.end()
              throw spawnState.error
            }

            let port: number | null = null
            let healthy = false
            let readPortFileMs = 0
            let probeHealthMs = 0
            try {
              const readPortFileStartMs = performance.now()
              port = await readPortFile(resolvedVault)
              readPortFileMs = performance.now() - readPortFileStartMs

              if (port !== null) {
                const probeHealthStartMs = performance.now()
                healthy = await probeHealth(resolvedVault, port)
                probeHealthMs = performance.now() - probeHealthStartMs
              }
            } catch (err) {
              setSpawnPollTimingAttributes(spawnSpan, pollTimings)
              spawnSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(err),
              })
              spawnSpan.end()
              throw err
            }

            recordSpawnPollIteration(pollTimings, {
              readPortFileMs,
              probeHealthMs,
              sleepMs: 0,
              portFound: port !== null,
              healthy,
            })

            if (port !== null && healthy) {
              spawnSpan.setAttribute('port', port)
              setSpawnPollTimingAttributes(spawnSpan, pollTimings)
              spawnSpan.end()
              return { port, pid: spawnedPid, launched: true }
            }

            // The spawned child detected the lock was already held and exited via
            // process.exit(0). Continuing to wait timeoutMs for a port file from a
            // dead child is pointless. Give the lock-holder one more reuse probe
            // (in case it's slow rather than dead), then surface a typed error so
            // the caller can recover by killing the orphan.
            if (alreadyRunningPid !== null) {
              let port: number | null
              try {
                port = await waitForHealthyPort(resolvedVault, {
                  initialBackoffMs: 100,
                  maxBackoffMs: 100,
                  timeoutMs: REUSE_PROBE_AFTER_LOCK_HELD_MS,
                })
              } catch (err) {
                setSpawnPollTimingAttributes(spawnSpan, pollTimings)
                spawnSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: String(err),
                })
                spawnSpan.end()
                throw err
              }
              if (port !== null) {
                spawnSpan.setAttribute('port', port)
                spawnSpan.setAttribute(
                  'alreadyRunningPid',
                  alreadyRunningPid,
                )
                setSpawnPollTimingAttributes(spawnSpan, pollTimings)
                spawnSpan.end()
                return {
                  port,
                  pid: alreadyRunningPid,
                  launched: false,
                }
              }
              const err = new DaemonLockHeldError(
                resolvedVault,
                alreadyRunningPid,
              )
              spawnSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              })
              setSpawnPollTimingAttributes(spawnSpan, pollTimings)
              spawnSpan.end()
              throw err
            }

            const remaining = deadline - Date.now()
            if (remaining <= 0) {
              break
            }
            const sleepMs = Math.min(backoff, remaining)
            const sleepStartMs = performance.now()
            await sleep(sleepMs)
            const actualSleepMs = performance.now() - sleepStartMs
            recordLastSpawnPollSleep(pollTimings, actualSleepMs)
            backoff = Math.min(backoff * 2, 100)
          }

          if (spawnState.error) {
            setSpawnPollTimingAttributes(spawnSpan, pollTimings)
            spawnSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: spawnState.error.message,
            })
            spawnSpan.end()
            throw spawnState.error
          }
          const err = new DaemonLaunchTimeout(
            launchTimeoutMessage(timeoutMs, resolvedVault, stderr),
          )
          spawnSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          })
          setSpawnPollTimingAttributes(spawnSpan, pollTimings)
          spawnSpan.end()
          throw err
        },
      )
    } catch (err) {
      ensureSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err),
      })
      throw err
    } finally {
      ensureSpan.end()
    }
  })
}
