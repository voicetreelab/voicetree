import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  DaemonLockHeldError,
  ensureDaemon,
  GraphDbClient,
  terminateUnresponsiveDaemon,
} from '@vt/graph-db-client'

export interface CachedDaemonConnection {
  client: GraphDbClient
  launched: boolean
  pid: number | null
  port: number
  vault: string
}

let cachedConnection: CachedDaemonConnection | null = null
let inflightConnection: Promise<CachedDaemonConnection> | null = null
let inflightVault: string | null = null

const DAEMON_EXIT_GRACE_MS = 1000
const DAEMON_SIGTERM_GRACE_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function terminateDaemonPidIfAlive(pid: number | null): Promise<void> {
  if (pid === null) return

  await sleep(DAEMON_EXIT_GRACE_MS)
  if (!isProcessAlive(pid)) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  await sleep(DAEMON_SIGTERM_GRACE_MS)
  if (!isProcessAlive(pid)) return

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Process already exited or cannot be signalled.
  }
}

async function shutdownConnection(connection: CachedDaemonConnection): Promise<void> {
  await connection.client.shutdown().catch(() => undefined)
  await terminateDaemonPidIfAlive(connection.pid)
}

async function assertVaultDirectory(vault: string): Promise<string> {
  const resolvedVault = resolve(vault)

  let info
  try {
    info = await stat(resolvedVault)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`Vault does not exist: ${resolvedVault}`)
    }
    throw error
  }

  if (!info.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${resolvedVault}`)
  }

  return resolvedVault
}

async function isHealthyForVault(
  connection: CachedDaemonConnection,
  vault: string,
): Promise<boolean> {
  try {
    const health = await connection.client.health()
    return health.vault === vault
  } catch {
    return false
  }
}

async function ensureDaemonWithOrphanRecovery(
  vault: string,
  opts?: { timeoutMs?: number },
): Promise<Awaited<ReturnType<typeof ensureDaemon>>> {
  try {
    return await ensureDaemon(vault, opts)
  } catch (err) {
    if (!(err instanceof DaemonLockHeldError)) throw err
    const terminated = await terminateUnresponsiveDaemon(vault, err.pid)
    if (!terminated) throw err
    return await ensureDaemon(vault, opts)
  }
}

async function buildConnection(
  vault: string,
  opts?: { timeoutMs?: number },
): Promise<CachedDaemonConnection> {
  let bootstrap = await ensureDaemonWithOrphanRecovery(vault, opts)
  let client = new GraphDbClient({
    baseUrl: `http://127.0.0.1:${bootstrap.port}`,
  })

  if (!bootstrap.launched) {
    await client.shutdown().catch(() => {})
    bootstrap = await ensureDaemonWithOrphanRecovery(vault, opts)
    client = new GraphDbClient({
      baseUrl: `http://127.0.0.1:${bootstrap.port}`,
    })
  }

  const health = await client.health()
  if (health.vault !== vault) {
    throw new Error(
      `vt-graphd health reported vault ${health.vault}, expected ${vault}`,
    )
  }

  return {
    client,
    launched: true,
    pid: bootstrap.pid,
    port: bootstrap.port,
    vault,
  }
}

export async function ensureDaemonClientForVault(
  vault: string,
  opts?: { timeoutMs?: number },
): Promise<CachedDaemonConnection> {
  const resolvedVault = await assertVaultDirectory(vault)

  if (
    cachedConnection?.vault === resolvedVault &&
    (await isHealthyForVault(cachedConnection, resolvedVault))
  ) {
    return cachedConnection
  }

  if (cachedConnection && cachedConnection.vault !== resolvedVault) {
    const staleConnection = cachedConnection
    cachedConnection = null
    await shutdownConnection(staleConnection)
  }

  if (
    inflightConnection !== null &&
    inflightVault === resolvedVault
  ) {
    return await inflightConnection
  }

  const pending = buildConnection(resolvedVault, opts)
  inflightConnection = pending
  inflightVault = resolvedVault

  try {
    const connection = await pending
    cachedConnection = connection
    return connection
  } finally {
    if (inflightConnection === pending) {
      inflightConnection = null
      inflightVault = null
    }
  }
}

export function getActiveDaemonConnection(): CachedDaemonConnection | null {
  return cachedConnection
}

export function getActiveDaemonClient(): GraphDbClient | null {
  return cachedConnection?.client ?? null
}

export async function shutdownActiveDaemonConnection(): Promise<void> {
  const connection = cachedConnection
    ?? (inflightConnection ? await inflightConnection.catch(() => null) : null)

  clearDaemonClientCache()
  if (connection) {
    await shutdownConnection(connection)
  }
}

export function clearDaemonClientCache(): void {
  cachedConnection = null
  inflightConnection = null
  inflightVault = null
}
