/**
 * Settings-aware wrapper around the core `createWorktree`.
 *
 * Reads the worktree-created hooks from settings and forwards them to the core
 * git command. Hook failure is non-blocking (handled in the core).
 *
 * Lives in its own module (rather than inline in `api.ts`) for two reasons:
 *   1. `api.ts` is a pure re-export surface — "Do not define functions in this
 *      file, only import and re-export."
 *   2. Keeping the wrapper out of `api.ts` lets it be black-box tested at the
 *      unit level (see `createWorktreeWithHooks.test.ts`) without dragging the
 *      whole Electron main-process dependency graph into the test. The crashing
 *      daemon-port-accessor `is not defined` regression escaped precisely because nothing
 *      executed this wrapper below the (non-gating) Electron e2e tier.
 */

import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@vt/graph-model/settings'
import {createWorktree as createWorktreeCore} from '@/shell/edge/main/workspace/worktree/gitWorktreeCommands'

/** A hook command commented out with a leading `#` is treated as "no hook". */
function effectiveHook(command: string | undefined): string | undefined {
    return command?.startsWith('#') ? undefined : command ?? undefined
}

export async function createWorktreeWithHooks(repoRoot: string, worktreeName: string): Promise<string> {
    const settings: VTSettings = await loadSettings()
    const effectiveBlocking: string | undefined = effectiveHook(settings.hooks?.onWorktreeCreatedBlocking)
    const effectiveAsync: string | undefined = effectiveHook(settings.hooks?.postWorktreeCreatedAsync)
    return createWorktreeCore(repoRoot, worktreeName, effectiveBlocking, effectiveAsync)
}
