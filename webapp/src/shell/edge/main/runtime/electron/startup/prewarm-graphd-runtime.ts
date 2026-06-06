import log from 'electron-log'
import { resolveDaemonRuntimeCommand } from '@vt/graph-db-client'

/**
 * Warm graphd's runtime-command resolution cache OFF the spawn hot path.
 *
 * `resolveDaemonRuntimeCommand()` spawnSyncs a candidate Node binary to probe
 * `node:sqlite`, then memoises the winner (see graph-db-client autoLaunch).
 * Resolved lazily, that probe lands on the user's FIRST agent spawn / project
 * ensure. Running it once at boot — deferred via `setImmediate` so it never
 * blocks window creation — means the first real `ensureGraphDaemonForProject`
 * hits a warm cache (0ms). This is belt-and-suspenders on top of excluding the
 * slow Electron-binary candidate: even the fast `node` probe is moved off the
 * click path.
 *
 * Best-effort and non-throwing: a failure here is harmless — the lazy path
 * re-resolves and surfaces the real error at the point it actually matters.
 * Pure-ish shell: the runtime probe, the defer, and the logger are injectable
 * so the behaviour is black-box testable without a real spawnSync.
 */
export function prewarmGraphdRuntimeCommand(
    deps: {
        readonly resolve?: () => string
        readonly defer?: (fn: () => void) => void
        readonly logger?: Pick<typeof log, 'info' | 'warn'>
    } = {},
): void {
    const resolve: () => string = deps.resolve ?? resolveDaemonRuntimeCommand
    const defer: (fn: () => void) => void = deps.defer ?? ((fn: () => void): void => { setImmediate(fn) })
    const logger: Pick<typeof log, 'info' | 'warn'> = deps.logger ?? log

    defer((): void => {
        try {
            const cmd: string = resolve()
            logger.info(`[Startup] prewarmed graphd runtime command: ${cmd}`)
        } catch (err) {
            logger.warn(`[Startup] graphd runtime prewarm failed (harmless; lazy path retries): ${(err as Error).message}`)
        }
    })
}
