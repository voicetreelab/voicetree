import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createEmptyGraph, initGraphModel } from '@vt/graph-model'
import { configureRootIO } from '@vt/graph-state'
import { loadGraphFromDisk } from '@vt/graph-db-server/graph/loadGraphFromDisk'
import { getDirectoryTree } from '@vt/graph-db-server/graph/folderScanner'
import { clearWatchFolderState } from '@vt/graph-db-server/state/watch-folder-store'
import { setGraph } from '@vt/graph-db-server/state/graph-store'

const tracer = trace.getTracer('vt-graphd')

export function resetDaemonGraphState(): void {
  clearWatchFolderState()
  setGraph(createEmptyGraph())
}

export function initDaemonGraphModel(appSupportPath: string): void {
  const span = tracer.startSpan('daemon.init-graph-model')
  try {
    initGraphModel({ appSupportPath })
    configureRootIO({
      getDirectoryTree,
      loadGraphFromDisk,
    })
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    throw err
  } finally {
    span.end()
  }
}
