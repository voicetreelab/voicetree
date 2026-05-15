import { refreshMainGraphFromDaemon } from './daemon-ipc-proxy'

const DAEMON_GRAPH_POLL_INTERVAL_MS = 750
const DAEMON_GRAPH_POLL_BACKGROUND_INTERVAL_MS = 5_000
const DAEMON_GRAPH_POLL_IDLE_INTERVAL_MS = 60_000

export type AppActivityTier = 'active' | 'background' | 'idle'

const TIER_INTERVALS: Record<AppActivityTier, number> = {
  active: DAEMON_GRAPH_POLL_INTERVAL_MS,
  background: DAEMON_GRAPH_POLL_BACKGROUND_INTERVAL_MS,
  idle: DAEMON_GRAPH_POLL_IDLE_INTERVAL_MS,
}
const DEFAULT_FAILURE_THRESHOLD = 5

export type DaemonGraphSyncFn = (vault: string) => Promise<void>

export interface DaemonGraphSyncOptions {
  syncFn?: DaemonGraphSyncFn
  pollIntervalMs?: number
  failureThreshold?: number
}

let activeVault: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let inflightSync: Promise<void> | null = null
let consecutiveFailures: number = 0
let activeSyncFn: DaemonGraphSyncFn | null = null
let activeIntervalMs: number = DAEMON_GRAPH_POLL_INTERVAL_MS
let activeFailureThreshold: number = DEFAULT_FAILURE_THRESHOLD

async function syncOnce(vault: string, syncFn: DaemonGraphSyncFn): Promise<void> {
  if (inflightSync) {
    await inflightSync
    return
  }

  const currentSync = syncFn(vault)
  inflightSync = currentSync

  try {
    await currentSync
  } finally {
    if (inflightSync === currentSync) {
      inflightSync = null
    }
  }
}

function startPollTimer(intervalMs: number): void {
  if (pollTimer) clearInterval(pollTimer)
  if (!activeVault || !activeSyncFn) return

  const vault = activeVault
  const syncFn = activeSyncFn
  const failureThreshold = activeFailureThreshold

  pollTimer = setInterval(() => {
    if (activeVault !== vault) return

    void syncOnce(vault, syncFn)
      .then(() => {
        consecutiveFailures = 0
      })
      .catch((error: unknown) => {
        consecutiveFailures += 1
        console.error('[daemon-watch-sync] failed to refresh daemon graph:', error)
        if (consecutiveFailures >= failureThreshold && pollTimer !== null) {
          clearInterval(pollTimer)
          pollTimer = null
          console.error(
            `[daemon-watch-sync] poll halted after ${consecutiveFailures} consecutive failures for vault ${vault}`,
          )
        }
      })
  }, intervalMs)
}

export async function startDaemonGraphSync(
  vault: string,
  options: DaemonGraphSyncOptions = {},
): Promise<void> {
  const syncFn: DaemonGraphSyncFn = options.syncFn ?? refreshMainGraphFromDaemon
  const intervalMs: number = options.pollIntervalMs ?? DAEMON_GRAPH_POLL_INTERVAL_MS
  const failureThreshold: number = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD

  if (activeVault === vault && pollTimer) {
    await syncOnce(vault, syncFn)
    return
  }

  await stopDaemonGraphSync()

  activeVault = vault
  activeSyncFn = syncFn
  activeIntervalMs = intervalMs
  activeFailureThreshold = failureThreshold
  consecutiveFailures = 0
  await syncOnce(vault, syncFn)

  startPollTimer(intervalMs)
}

export function setDaemonGraphSyncTier(tier: AppActivityTier): void {
  if (!activeVault || !activeSyncFn) return
  startPollTimer(TIER_INTERVALS[tier])
  if (tier === 'active') {
    void syncOnce(activeVault, activeSyncFn).catch(() => {})
  }
}

export async function stopDaemonGraphSync(): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  activeVault = null
  activeSyncFn = null
  consecutiveFailures = 0

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
