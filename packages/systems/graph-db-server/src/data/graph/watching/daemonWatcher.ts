import { basename } from 'node:path'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import normalizePath from 'normalize-path'
import {
  isImageNode,
  type FSDelete,
  type FSUpdate,
  type GraphNode,
} from '@vt/graph-model'
import { toAbsolutePath } from '@vt/graph-model/folders'
import { handleFSEventWithStateAndUISides } from './handleFSEvent.ts'
import {
  readFileWithRetry,
  createWatchIgnorePredicate,
} from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import type { FileWatcherLogger } from '@vt/graph-db-server/watch-folder/watching/file-watcher-setup'
import { shouldIngestAddedFile } from '@vt/graph-db-server/watch-folder/watching/folderLoadGate'
import {
  createMoveCorrelator,
  type MoveCorrelator,
} from '@vt/graph-db-server/watch-folder/watching/moveCorrelator'
import {
  identitiesMatch,
  identityOfAddedMarkdown,
  identityOfNode,
  type MoveIdentity,
} from '@vt/graph-db-server/watch-folder/watching/moveIdentity'
import { consumeBroadcastSuppression } from '@vt/graph-db-server/watch-folder/pending-writes'
import { getGraph } from '@vt/graph-db-server/state/graph-store'
import { getFolderTreeReadModel } from '@vt/graph-db-server/state/folder-tree-read-model-store'

export type Watcher = {
  readonly ready: Promise<void>
  add(path: string): void
  unwatch(path: string): void
  unmount(): Promise<void>
}

export interface MountWatcherDependencies {
  readonly readFileWithRetry: typeof readFileWithRetry
  readonly handleFSEvent: typeof handleFSEventWithStateAndUISides
  readonly logger: FileWatcherLogger
  /** The loaded graph's `nodes` record, read fresh per 'add' to decide whether
   *  an added file's containing folder is already loaded. */
  readonly getGraphNodes: () => Readonly<Record<string, unknown>>
  /** A single loaded node by id (its normalized absolute path), read fresh at
   *  'unlink' to capture the move identity of the node being deleted. */
  readonly getGraphNode: (nodeId: string) => GraphNode | undefined
  /** Move-correlation window in ms; injectable for tests. Defaults to the
   *  correlator's own default. */
  readonly moveWindowMs?: number
}

const defaultMountWatcherDependencies: MountWatcherDependencies = {
  readFileWithRetry,
  handleFSEvent: handleFSEventWithStateAndUISides,
  logger: {
    error(message?: unknown, ...optionalParams: unknown[]): void {
      console.error(message, ...optionalParams)
    },
  },
  getGraphNodes: () => getGraph().nodes,
  getGraphNode: (nodeId: string): GraphNode | undefined => getGraph().nodes[nodeId],
}

function waitForReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      watcher.off('ready', onReady)
      watcher.off('error', onError)
    }
    const onReady = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: unknown): void => {
      cleanup()
      reject(error)
    }

    watcher.once('ready', onReady)
    watcher.once('error', onError)
  })
}

function buildWatcherOptions(watchRoots: readonly string[]) {
  // fsevents on macOS silently drops 'add' events for some project paths
  // (reproduced deterministically: chokidar 3.6.0 + fsevents 2.3.3, dir under
  // ~/Voicetree/voicetree-…/voicetree-…/). Polling is the only reliable
  // backend in dev where this matters most for agent progress nodes.
  const usePolling =
    process.env.HEADLESS_TEST === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development'

  return {
    // Shared single-source-of-truth predicate (see createWatchIgnorePredicate):
    // accepts .md/image files below a watch root, excludes hidden/noise dirs
    // such as `.voicetree/`, and preserves the fsevents-readiness invariant
    // (never ignore a directory or a stats-less path) that prevents
    // `watcher.ready` from hanging on dotted-basename project roots.
    ignored: [createWatchIgnorePredicate(watchRoots)],
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 99,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
    usePolling,
    interval: usePolling ? 100 : undefined,
    binaryInterval: usePolling ? 300 : undefined,
  }
}

export function mountWatcher(
  readPaths: readonly string[],
  watchedDir: string,
  dependencies: MountWatcherDependencies = defaultMountWatcherDependencies,
): Watcher {
  const watcher: FSWatcher = chokidar.watch([...readPaths], buildWatcherOptions(readPaths))
  const ready = waitForReady(watcher)

  // The currently-mounted project paths (watch roots), kept in lockstep with
  // `add`/`unwatch` so the ingestion gate always sees live roots: a folder the
  // user just loaded becomes a root and its files start ingesting; an unloaded
  // folder stops being one.
  const mountedRoots = new Set<string>(readPaths.map((p) => normalizePath(p)))
  // Pairs the unlink+add of a filesystem move so a loaded note moved into an
  // unloaded folder re-enters the graph (and its incoming [[wikilink]] heals)
  // instead of being dropped by the gate. See moveCorrelator / moveIdentity.
  const correlator: MoveCorrelator = createMoveCorrelator({ windowMs: dependencies.moveWindowMs })

  const invalidateFolderTreeFor = (filePath: string): void => {
    getFolderTreeReadModel().invalidate({
      kind: 'pathChanged',
      absolutePath: toAbsolutePath(normalizePath(filePath)),
    })
  }

  // Emit an 'Added' for an already-read file, consuming any broadcast
  // suppression at emit time. Used for move-detected adds (content in hand).
  const emitAdded = (filePath: string, content: string): void => {
    const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
    const fsUpdate: FSUpdate = { absolutePath: filePath, content, eventType: 'Added' }
    dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
  }

  // Normal ingestion path: consume suppression synchronously (as the add event
  // is observed), then read and emit. Used when the gate admits the file.
  const ingestAddedFile = (filePath: string): void => {
    const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
    const contentPromise = isImageNode(filePath)
      ? Promise.resolve('')
      : dependencies.readFileWithRetry(filePath)
    void contentPromise
      .then((content: string) => {
        const fsUpdate: FSUpdate = { absolutePath: filePath, content, eventType: 'Added' }
        dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher add failed for ${filePath}:`, error)
      })
  }

  watcher.on('add', (filePath: string) => {
    // Loaded folder → ingest normally.
    if (shouldIngestAddedFile(filePath, mountedRoots, dependencies.getGraphNodes())) {
      ingestAddedFile(filePath)
      return
    }

    // "New folders unloaded by default": a file in a brand-new, not-yet-loaded
    // folder (e.g. a git worktree checkout) must not flood the workspace. But it
    // may instead be the landing half of a MOVE of a loaded note into such a
    // folder — recognise that so the moved node re-enters the graph and its
    // incoming [[wikilink]] heals. Images carry no comparable content identity,
    // so they only ever take the unloaded path.
    const base: string = basename(filePath)
    if (isImageNode(filePath) || correlator.pendingUnlinkIdentities(base).length === 0) {
      // No just-unlinked loaded node to pair with. Buffer the path in case the
      // unlink arrives next (add→unlink ordering), then leave the folder unloaded.
      if (!isImageNode(filePath)) correlator.recordDroppedAdd(base, filePath)
      invalidateFolderTreeFor(filePath)
      return
    }

    // A loaded node with this basename was just unlinked — read the added file
    // and compare identity. Exactly one match ⇒ it is that node, moved.
    void dependencies.readFileWithRetry(filePath)
      .then((content: string) => {
        const added: MoveIdentity = identityOfAddedMarkdown(content, filePath)
        const matches: readonly MoveIdentity[] = correlator
          .pendingUnlinkIdentities(base)
          .filter((id) => identitiesMatch(id, added))
        if (matches.length === 1) {
          correlator.consumeUnlink(base, matches[0])
          emitAdded(filePath, content) // MOVE: ingest, bypassing the gate
          return
        }
        // 0 matches (different content) or >1 (ambiguous) ⇒ a fresh file: stay unloaded.
        correlator.recordDroppedAdd(base, filePath)
        invalidateFolderTreeFor(filePath)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher move-probe failed for ${filePath}:`, error)
        invalidateFolderTreeFor(filePath)
      })
  })

  watcher.on('change', (filePath: string) => {
    // A 'Changed' event upserts just like 'Added', so the same gate applies:
    // never pull a file from an unloaded folder into the graph via an edit (an
    // agent creating then editing a `.md` inside an unloaded worktree must stay
    // unloaded). Files in loaded folders keep updating normally.
    if (!shouldIngestAddedFile(filePath, mountedRoots, dependencies.getGraphNodes())) {
      return
    }

    const suppressBroadcastTo: ReadonlySet<string> = consumeBroadcastSuppression(filePath)
    if (isImageNode(filePath)) {
      return
    }

    void dependencies.readFileWithRetry(filePath)
      .then((content: string) => {
        const fsUpdate: FSUpdate = {
          absolutePath: filePath,
          content,
          eventType: 'Changed',
        }
        dependencies.handleFSEvent(fsUpdate, watchedDir, suppressBroadcastTo)
      })
      .catch((error: unknown) => {
        dependencies.logger.error(`graphd watcher change failed for ${filePath}:`, error)
      })
  })

  watcher.on('unlink', (filePath: string) => {
    // If a loaded node is disappearing, this may be the leaving half of a move.
    // Capture its identity SYNCHRONOUSLY — before handleFSEvent applies the
    // delete — so the node is still present when we read it.
    const node: GraphNode | undefined = dependencies.getGraphNode(normalizePath(filePath))
    if (node !== undefined) {
      const base: string = basename(filePath)
      const identity: MoveIdentity = identityOfNode(node)
      // add→unlink ordering: a matching add may already be buffered (gated out
      // before this unlink). Resurrect it so the moved node loads.
      resurrectBufferedMovedAdd(base, identity)
      // unlink→add ordering: let a matching add arriving within the window through.
      correlator.recordUnlink(base, identity)
    }
    const fsDelete: FSDelete = {
      type: 'Delete',
      absolutePath: filePath,
    }
    dependencies.handleFSEvent(fsDelete, watchedDir)
  })

  // Resolve the add→unlink ordering of a move: among adds previously gated out
  // and buffered under `base`, find the unique one whose content identity
  // matches the node now being unlinked, and ingest it.
  function resurrectBufferedMovedAdd(base: string, unlinkedIdentity: MoveIdentity): void {
    const candidatePaths: readonly string[] = correlator.pendingDroppedAddPaths(base)
    if (candidatePaths.length === 0) return
    void Promise.all(
      candidatePaths.map((path) =>
        dependencies
          .readFileWithRetry(path)
          .then((content: string) => ({ path, content, identity: identityOfAddedMarkdown(content, path) }))
          .catch(() => null),
      ),
    ).then((results) => {
      const matches = results.filter(
        (r): r is { path: string; content: string; identity: MoveIdentity } =>
          r !== null && identitiesMatch(r.identity, unlinkedIdentity),
      )
      if (matches.length !== 1) return
      correlator.consumeDroppedAdd(base, matches[0].path)
      emitAdded(matches[0].path, matches[0].content) // MOVE: ingest, bypassing the gate
    })
  }

  watcher.on('error', (error: unknown) => {
    dependencies.logger.error('graphd watcher error:', error)
  })

  return {
    ready,
    add(path: string): void {
      mountedRoots.add(normalizePath(path))
      watcher.add(path)
    },
    unwatch(path: string): void {
      mountedRoots.delete(normalizePath(path))
      watcher.unwatch(path)
    },
    async unmount(): Promise<void> {
      correlator.dispose()
      await watcher.close()
    },
  }
}
