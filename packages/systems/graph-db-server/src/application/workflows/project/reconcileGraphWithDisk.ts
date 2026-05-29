import type { GraphDelta } from '@vt/graph-model/graph'
import { executeCommand } from '../dispatch.ts'

/**
 * One-shot reconciliation: delete graph nodes whose backing files are gone
 * from disk. Skips paths with pending daemon writes (so a delete racing a
 * write does not undo the write). Applies the resulting delta to memory and
 * broadcasts it via the same sequence handleFSEventWithStateAndUISides uses.
 *
 * Used at project-open and on the daemon `/graph/reconcile-disk` route so that
 * an external file removal (git checkout, manual `rm`, agent batch) does not
 * leave stale nodes in the in-memory graph or in any open floating editors.
 *
 * Lives in application/ (shell layer) because the `fs.access` probe is an
 * effect; per the FP rearchitecting guidance, effects belong at the shell
 * boundary, not in data/.
 */
export async function reconcileGraphWithDisk(): Promise<GraphDelta> {
  return await executeCommand({ type: 'ReconcileGraphWithDisk' })
}
