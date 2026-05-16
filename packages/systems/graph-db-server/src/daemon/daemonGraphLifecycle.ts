import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createEmptyGraph, initGraphModel } from '@vt/graph-model'
import { configureRootIO } from '@vt/graph-state'
import { loadGraphFromDisk } from '../data/graph/loading/loadGraphFromDisk.ts'
import { getDirectoryTree } from '../data/graph/loading/folderScanner.ts'
import { clearWatchFolderState } from '../state/watch-folder-store.ts'
import { setGraph } from '../state/graph-store.ts'

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
