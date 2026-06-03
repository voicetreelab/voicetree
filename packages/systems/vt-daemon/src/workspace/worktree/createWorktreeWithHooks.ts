/**
 * Settings-aware wrapper around the core `createWorktree`.
 *
 * Reads the worktree-created hooks from settings and forwards them to the core
 * git command. Hook failure is non-blocking (handled in the core).
 *
 * Lives in its own module so it can be black-box tested at the unit level (see
 * `createWorktreeWithHooks.test.ts`) — calling the real wrapper against a
 * throwaway repo with `VOICETREE_HOME_PATH` pointed at temp settings — without
 * dragging a daemon/Electron dependency graph into the test.
 */

import { loadSettings } from '@vt/app-config/settings'
import type { VTSettings } from '@vt/graph-model/settings'
import { createWorktree as createWorktreeCore } from './gitWorktreeCommands.ts'

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
