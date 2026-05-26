/**
 * Renderer-facing accessor for the in-process unified HTTP daemon's URL
 * (Step 9 §2.7). Exposed via mainAPI.getDaemonUrl.
 *
 * Source of truth is the bound state in http-server-binding.ts — set
 * atomically when `bindHttpDaemonForVault` settles. No disk I/O: the daemon
 * is in-process, so `<vault>/.voicetree/rpc.port` is only an artifact for
 * out-of-process consumers (CLI, hook subprocesses, spawned agents) that
 * discover via vt-rpc's path discovery. Reading from disk in the same
 * process would re-introduce a writer/reader path-resolution mismatch when
 * `writeFolder !== projectRoot`, plus a race window between
 * `startHttpDaemonServer` resolving and `writeRpcPortFile` settling.
 *
 * `$VOICETREE_DAEMON_URL` still wins so tests / dev overrides can redirect
 * to an external daemon.
 *
 * Auth-token reads removed from this module (BF-368): Main-side bridges
 * call `getActiveAuthToken` from http-server-binding directly, and the
 * renderer no longer holds the bearer token at all.
 */
import {getActiveDaemonUrl} from './http-server-binding'

export async function getDaemonUrl(): Promise<string> {
    if (process.env.VOICETREE_DAEMON_URL) return process.env.VOICETREE_DAEMON_URL
    const url: string | null = getActiveDaemonUrl()
    if (!url) throw new Error('daemon_unreachable: no active daemon')
    return url
}
