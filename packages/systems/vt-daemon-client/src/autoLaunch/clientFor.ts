/**
 * Construct a {@link VtDaemonClient} bound to a discovered loopback port
 * and the daemon's published bearer auth token. Used by both the
 * spawn-loop's `clientFor` callback (passed into `attemptSpawnAndWait`)
 * and by `ensureVtDaemon`'s reuse path.
 *
 * The auth token is read SYNCHRONOUSLY inside the factory because the
 * spawnCoordinator's `clientFor: (port: number) => TClient` callback is
 * synchronous (it returns the constructed client inline with the
 * spawn-result envelope). The token file is local, small (~64 bytes,
 * mode 0600), and is written by `bin/vtd.ts` (BF-371) BEFORE the daemon
 * binds its HTTP port — so by the time spawnCoordinator's discovery loop
 * sees a healthy `/health` response, the token file is guaranteed to be
 * present. A read failure here is a protocol violation (the daemon
 * promised to write it; absence indicates corruption or a third party
 * deleting it), and we surface it as a thrown error rather than retrying
 * — retry would silently mask a fork-storm / cleanup race.
 */

import { readFileSync } from 'node:fs'
import { authTokenFilePath } from '@vt/vt-rpc'
import { VtDaemonClient } from '../VtDaemonClient.ts'

export function vtClientFor(port: number, vault: string): VtDaemonClient {
  const token = readVtdAuthTokenSync(vault)
  return new VtDaemonClient({
    baseUrl: `http://127.0.0.1:${port}`,
    authToken: token,
  })
}

function readVtdAuthTokenSync(vault: string): string {
  const path = authTokenFilePath(vault)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new Error(
      `vt-daemon-client: failed to read auth token at ${path}: ${(cause as Error).message}`,
    )
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new Error(
      `vt-daemon-client: auth token at ${path} is empty — daemon did not finish publishing its token`,
    )
  }
  return trimmed
}
