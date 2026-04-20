import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ensureDaemon, GraphDbClient } from '@vt/graph-db-client'

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

async function buildConnection(vault: string): Promise<CachedDaemonConnection> {
  const bootstrap = await ensureDaemon(vault)
  const client = new GraphDbClient({
    baseUrl: `http://127.0.0.1:${bootstrap.port}`,
  })
  const health = await client.health()

  if (health.vault !== vault) {
    throw new Error(
      `vt-graphd health reported vault ${health.vault}, expected ${vault}`,
    )
  }

  return {
    client,
    launched: bootstrap.launched,
    pid: bootstrap.pid,
    port: bootstrap.port,
    vault,
  }
}

export async function ensureDaemonClientForVault(
  vault: string,
): Promise<CachedDaemonConnection> {
  const resolvedVault = await assertVaultDirectory(vault)

  if (
    cachedConnection?.vault === resolvedVault &&
    (await isHealthyForVault(cachedConnection, resolvedVault))
  ) {
    return cachedConnection
  }

  if (
    inflightConnection !== null &&
    inflightVault === resolvedVault
  ) {
    return await inflightConnection
  }

  const pending = buildConnection(resolvedVault)
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

export function clearDaemonClientCache(): void {
  cachedConnection = null
  inflightConnection = null
  inflightVault = null
}
