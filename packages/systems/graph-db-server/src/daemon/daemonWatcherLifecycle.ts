import { SpanStatusCode, trace } from '@opentelemetry/api'
import { mountWatcher, type Watcher } from '../data/graph/watching/daemonWatcher.ts'
import { onReadPathsChanged } from '../state/watch-folder-store.ts'
import { getVaultPaths } from '../state/vaultAllowlist.ts'
import type { DaemonLogger } from './daemonTypes.ts'

const tracer = trace.getTracer('vt-graphd')

export type DaemonWatcherController = {
  stop(): Promise<void>
}

async function mountReadyWatcher(
  watchPaths: readonly string[],
  vault: string,
): Promise<Watcher> {
  const watcher = mountWatcher(watchPaths, vault)
  try {
    await watcher.ready
    return watcher
  } catch (err) {
    await watcher.unmount().catch(() => {})
    throw err
  }
}

export async function startDaemonWatcher(
  vault: string,
  logger: DaemonLogger,
): Promise<DaemonWatcherController> {
  return tracer.startActiveSpan('daemon.mount-watcher', async (span) => {
    try {
      let watcher = await mountReadyWatcher(await getVaultPaths(), vault)
      let watcherStopped = false
      let remountChain: Promise<void> = Promise.resolve()

      const queueRemount = (watchPaths: readonly string[]): void => {
        remountChain = remountChain
          .then(async () => {
            if (watcherStopped) {
              return
            }
            await watcher.unmount()
            if (watcherStopped) {
              return
            }
            const nextWatcher = await mountReadyWatcher(watchPaths, vault)
            if (watcherStopped) {
              await nextWatcher.unmount()
              return
            }
            watcher = nextWatcher
          })
          .catch((error: unknown) => {
            logger.error('graphd watcher remount failed:', error)
          })
      }

      const unsubscribeReadPaths = onReadPathsChanged(queueRemount)

      return {
        async stop(): Promise<void> {
          if (watcherStopped) {
            return
          }
          watcherStopped = true
          unsubscribeReadPaths()
          await remountChain
          await watcher.unmount()
        },
      }
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}
