// Aggregate index of the 20 BF-376 outbound RPC routes (19 design.md §1 + 1
// post-merge `removePersistedAgentRecord` for renderer-side on-disk delete).
//
// Consumers:
//   - `tools/catalog.ts`'s dispatch builder merges these into the
//     name→handler map served by `/rpc`.
//   - Integration tests iterate `RPC_ROUTES` to assert "every protocol method
//     has a registered handler" via `TERMINAL_RPC_METHODS`.
//
// Order matches `TERMINAL_RPC_METHODS` for the audit-coverage test.

import type {RpcRoute} from './RpcRoute.ts'
import {SPAWN_ROUTES} from './spawnRoutes.ts'
import {INJECT_ROUTES} from './injectRoutes.ts'
import {READ_ROUTES} from './readRoutes.ts'
import {TMUX_UNCLAIMED_ROUTES} from './tmuxUnclaimedRoutes.ts'
import {HEADLESS_ROUTES} from './headlessRoutes.ts'
import {RECOVERY_ROUTES} from './recoveryRoutes.ts'
import {REGISTRY_ROUTES} from './registryRoutes.ts'
import {HOOK_ROUTES} from './hookRoutes.ts'

export type {RpcHandler, RpcRoute} from './RpcRoute.ts'

export const RPC_ROUTES: readonly RpcRoute[] = [
    ...SPAWN_ROUTES,
    ...INJECT_ROUTES,
    ...READ_ROUTES,
    ...TMUX_UNCLAIMED_ROUTES,
    ...HEADLESS_ROUTES,
    ...RECOVERY_ROUTES,
    ...REGISTRY_ROUTES,
    ...HOOK_ROUTES,
] as const
