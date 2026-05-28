import { unlink } from 'node:fs/promises'

import { fetchDaemonGraph, fetchJson, fileExists } from './daemon-http.ts'
import type { TrackedState } from './types.ts'

// Best-effort cleanup of test-owned entities between fuzz sequences.
//
// We DELETE every test-owned node still in the graph and unlink every tracked
// file still on disk, then record everything we attempted to delete in
// `deletedNodeIds`. Because `deletedNodeIds` accumulates across sequences (it
// is never reset), invariant I3's `targetWasDeleted` predicate keeps holding
// for any edge that points at a previously-cleaned node — converting the
// original cross-sequence I3 false-positive into a silent (correct) pass.
//
// We do not require the daemon's graph to actually empty: the daemon's
// DELETE /graph/node/:id workflow currently returns 500 when its internal
// fs.unlink races with a watcher-driven unlink (ENOENT), and any node it
// fails to remove will persist. That's a daemon bug, not a test problem —
// recording the attempted deletion is what keeps I3 honest until the daemon
// is fixed.
export async function cleanupSequence(
  baseUrl: string,
  tracked: TrackedState,
): Promise<void> {
  const owned = tracked.testOwnedNodeIds
  const initial = await fetchDaemonGraph(baseUrl)
  const ownedInGraph = Object.keys(initial.nodes).filter((id) => owned.has(id))

  await Promise.all(ownedInGraph.map(async (id) => {
    tracked.deletedNodeIds.add(id)
    await fetchJson(`${baseUrl}/graph/node/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
  }))

  for (const filePath of tracked.filesOnDisk.keys()) {
    tracked.deletedNodeIds.add(filePath)
    if (await fileExists(filePath)) {
      await unlink(filePath).catch(() => {})
    }
  }
}
