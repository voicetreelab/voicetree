import { refreshMainGraphFromDaemon } from './daemon-ipc-proxy'

const DAEMON_GRAPH_POLL_INTERVAL_MS = 750

let activeVault: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let inflightSync: Promise<void> | null = null

async function syncOnce(vault: string): Promise<void> {
  if (inflightSync) {
    await inflightSync
    return
  }

  const currentSync = refreshMainGraphFromDaemon(vault)
  inflightSync = currentSync

  try {
    await currentSync
  } finally {
    if (inflightSync === currentSync) {
      inflightSync = null
    }
  }
}

export async function startDaemonGraphSync(vault: string): Promise<void> {
  if (activeVault === vault && pollTimer) {
    await syncOnce(vault)
    return
  }

  await stopDaemonGraphSync()

  activeVault = vault
  await syncOnce(vault)

  pollTimer = setInterval(() => {
    if (activeVault !== vault) {
      return
    }

    void syncOnce(vault).catch((error: unknown) => {
      console.error('[daemon-watch-sync] failed to refresh daemon graph:', error)
    })
  }, DAEMON_GRAPH_POLL_INTERVAL_MS)
}

export async function stopDaemonGraphSync(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  activeVault = null

  const pendingSync = inflightSync
  if (pendingSync) {
    try {
      await pendingSync
    } catch {
      // Start-up and teardown callers decide whether the initial sync failure is fatal.
    }
  }
}

export function isDaemonGraphSyncActive(): boolean {
  return activeVault !== null
}
