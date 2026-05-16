import { SpanStatusCode, trace } from '@opentelemetry/api'
import { createEmptyGraph, initGraphModel } from '@vt/graph-model'
import { configureRootIO } from '@vt/graph-state'
import { getVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { loadGraphFromDisk } from '../data/graph/loading/loadGraphFromDisk.ts'
import { getDirectoryTree } from '../data/graph/loading/folderScanner.ts'
import { ensureDefaultFolderVisibilityView } from '../data/views/viewsRepository.ts'
import { clearWatchFolderState } from '../state/watch-folder-store.ts'
import { resolveWritePath, setVaultPath, setWritePath } from '../state/vaultAllowlist.ts'
import { setGraph } from '../state/graph-store.ts'

const tracer = trace.getTracer('vt-graphd')

type LoadWritePathOptions = {
  readonly vault: string
  readonly createStarterIfEmpty: boolean | undefined
}

function resolveConfiguredWritePath(vault: string, configuredWritePath: string | undefined): string {
  return configuredWritePath
    ? resolveWritePath(vault, configuredWritePath)
    : vault
}

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

export async function loadDaemonWritePath(
  options: LoadWritePathOptions,
): Promise<void> {
  await tracer.startActiveSpan('daemon.set-write-path', async (span) => {
    try {
      setVaultPath(options.vault)
      const savedConfig = await getVaultConfigForDirectory(options.vault)
      const resolvedWritePath = resolveConfiguredWritePath(
        options.vault,
        savedConfig?.writePath,
      )
      const result = await setWritePath(resolvedWritePath, {
        createStarterIfEmpty: options.createStarterIfEmpty,
      })
      span.setAttribute('writePath', resolvedWritePath)
      if (result.success) {
        return
      }
      const message = result.error ?? `Failed to load vault ${options.vault}`
      span.setStatus({ code: SpanStatusCode.ERROR, message })
      throw new Error(message)
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}

export function ensureDaemonFolderVisibility(vault: string): void {
  const span = tracer.startSpan('daemon.folder-visibility-db')
  try {
    ensureDefaultFolderVisibilityView(vault)
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
    throw err
  } finally {
    span.end()
  }
}
