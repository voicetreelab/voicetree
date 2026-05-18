import { resolve } from 'node:path'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
} from './errors.ts'
import {
  REUSE_PROBE_AFTER_LOCK_HELD_MS,
  readAliveLockHolder,
  traceReuseDiscoverPort,
  traceReuseProbeHealth,
  waitForHealthyPort,
} from './autoLaunch/probes.ts'
import {
  resolveCommand,
  resolveDaemonRuntimeCommand,
} from './autoLaunch/runtime.ts'
import { type EnsureDaemonResult } from './autoLaunch/types.ts'
import { waitForSpawnedDaemon } from './autoLaunch/spawnWait.ts'
import { initTracing } from './tracing.ts'

const tracer = trace.getTracer('vt-daemon-client')

let tracingInitialized = false
function ensureTracingInit(): void {
  if (tracingInitialized) return
  tracingInitialized = true
  initTracing('vt-daemon-client')
}

export type { EnsureDaemonResult } from './autoLaunch/types.ts'
export { resolveDaemonRuntimeCommand }
export { spawnVaultlessDaemon } from './autoLaunch/vaultlessSpawn.ts'
export type {
  SpawnVaultlessDaemonOptions,
  VaultlessDaemonHandle,
} from './autoLaunch/vaultlessSpawn.ts'

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
      const command = tracer.startActiveSpan(
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
        async (spawnSpan) =>
          waitForSpawnedDaemon(command, resolvedVault, timeoutMs, spawnSpan),
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
