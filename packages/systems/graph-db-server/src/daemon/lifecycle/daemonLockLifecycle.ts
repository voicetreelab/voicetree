import { SpanStatusCode, trace } from '@opentelemetry/api'
import { acquireLock, type LockHandle } from './lock.ts'
import { readPortFile } from './portFile.ts'
import type { DaemonHandle, DaemonLogger } from './daemonTypes.ts'

const tracer = trace.getTracer('vt-graphd')

export type DaemonLockResult =
  | { kind: 'acquired'; lockHandle: LockHandle }
  | { kind: 'already-running'; handle: DaemonHandle }

function formatAlreadyRunningMessage(vault: string, pid: number): string {
  return `vt-graphd: already running for ${vault} (pid ${pid})\n`
}

export async function acquireDaemonLock(
  vault: string,
  logger: DaemonLogger,
): Promise<DaemonLockResult> {
  return tracer.startActiveSpan('daemon.acquire-lock', async (span) => {
    try {
      const lockResult = await acquireLock(vault)
      if ('kind' in lockResult) {
        span.setAttribute('alreadyRunning', true)
        const existingPort = (await readPortFile(vault)) ?? 0
        logger.writeStderr(formatAlreadyRunningMessage(vault, lockResult.pid))
        const result: DaemonLockResult = {
          kind: 'already-running',
          handle: {
            port: existingPort,
            alreadyRunning: { pid: lockResult.pid },
            stop: async () => {},
          },
        }
        return result
      }
      const result: DaemonLockResult = { kind: 'acquired', lockHandle: lockResult }
      return result
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}
