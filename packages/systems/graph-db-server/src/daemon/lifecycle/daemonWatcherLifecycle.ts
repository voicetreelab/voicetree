import { SpanStatusCode, trace } from '@opentelemetry/api'
import { mountWatcher, type Watcher } from '@vt/graph-db-server/graph/daemonWatcher'
import { onReadPathsChanged } from '@vt/graph-db-server/state/watch-folder-store'
import { getProjectPaths } from '@vt/graph-db-server/state/projectAllowlist'
import type { DaemonLogger } from '../daemonTypes.ts'

const tracer = trace.getTracer('vt-graphd')

export type DaemonWatcherController = {
  stop(): Promise<void>
}

export async function startDaemonWatcher(
  project: string,
  logger: DaemonLogger,
): Promise<DaemonWatcherController> {
  return tracer.startActiveSpan('daemon.mount-watcher', async (span) => {
    try {
      const initialPaths = await getProjectPaths()
      const watcher: Watcher = mountWatcher(initialPaths, project)
      let watcherStopped = false
      let currentPaths = new Set<string>(initialPaths)

      // Apply path-set diff incrementally — no unmount/remount, no watch gap.
      // Registered before watcher.ready so changes during initial scan are not lost.
      const applyPathDiff = (newPaths: readonly string[]): void => {
        if (watcherStopped) return
        const newSet = new Set(newPaths)
        for (const p of newSet) {
          if (!currentPaths.has(p)) watcher.add(p)
        }
        for (const p of currentPaths) {
          if (!newSet.has(p)) watcher.unwatch(p)
        }
        currentPaths = newSet
      }

      const unsubscribeReadPaths = onReadPathsChanged(applyPathDiff)

      try {
        await watcher.ready
      } catch (err) {
        unsubscribeReadPaths()
        await watcher.unmount().catch(() => {})
        throw err
      }

      return {
        async stop(): Promise<void> {
          if (watcherStopped) return
          watcherStopped = true
          unsubscribeReadPaths()
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
