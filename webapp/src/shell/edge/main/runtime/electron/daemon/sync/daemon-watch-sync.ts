import { refreshMainGraphFromDaemon } from '../ipc/daemon-ipc-proxy'

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

type DaemonGraphSyncController = {
  readonly start: (vault: string, options?: DaemonGraphSyncOptions) => Promise<void>
  readonly setTier: (tier: AppActivityTier) => void
  readonly stop: () => Promise<void>
  readonly isActive: () => boolean
}

type DaemonGraphSyncState = {
  activeVault: string | null
  pollTimer: ReturnType<typeof setInterval> | null
  inflightSync: Promise<void> | null
  consecutiveFailures: number
  activeSyncFn: DaemonGraphSyncFn | null
  activeFailureThreshold: number
}

function createDaemonGraphSyncState(): DaemonGraphSyncState {
  return {
    activeFailureThreshold: DEFAULT_FAILURE_THRESHOLD,
    activeSyncFn: null,
    activeVault: null,
    consecutiveFailures: 0,
    inflightSync: null,
    pollTimer: null,
  }
}

async function syncOnce(state: DaemonGraphSyncState, vault: string, syncFn: DaemonGraphSyncFn): Promise<void> {
  if (state.inflightSync) {
    await state.inflightSync
    return
  }

  const currentSync = syncFn(vault)
  state.inflightSync = currentSync

  try {
    await currentSync
  } finally {
    if (state.inflightSync === currentSync) {
      state.inflightSync = null
    }
  }
}

function haltPollTimer(state: DaemonGraphSyncState, vault: string): void {
  if (state.pollTimer === null) return
  clearInterval(state.pollTimer)
  state.pollTimer = null
  console.error(
    `[daemon-watch-sync] poll halted after ${state.consecutiveFailures} consecutive failures for vault ${vault}`,
  )
}

function handlePollFailure(state: DaemonGraphSyncState, vault: string, failureThreshold: number, error: unknown): void {
  state.consecutiveFailures += 1
  console.error('[daemon-watch-sync] failed to refresh daemon graph:', error)
  if (state.consecutiveFailures >= failureThreshold) {
    haltPollTimer(state, vault)
  }
}

function runPollTick(state: DaemonGraphSyncState, vault: string, syncFn: DaemonGraphSyncFn, failureThreshold: number): void {
  if (state.activeVault !== vault) return
  void syncOnce(state, vault, syncFn)
    .then(() => {
      state.consecutiveFailures = 0
    })
    .catch((error: unknown) => handlePollFailure(state, vault, failureThreshold, error))
}

function startPollTimer(state: DaemonGraphSyncState, intervalMs: number): void {
  if (state.pollTimer) clearInterval(state.pollTimer)
  if (!state.activeVault || !state.activeSyncFn) return

  const vault = state.activeVault
  const syncFn = state.activeSyncFn
  const failureThreshold = state.activeFailureThreshold
  state.pollTimer = setInterval(() => runPollTick(state, vault, syncFn, failureThreshold), intervalMs)
}

function activateState(state: DaemonGraphSyncState, vault: string, syncFn: DaemonGraphSyncFn, failureThreshold: number): void {
  state.activeVault = vault
  state.activeSyncFn = syncFn
  state.activeFailureThreshold = failureThreshold
  state.consecutiveFailures = 0
}

async function startSync(state: DaemonGraphSyncState, vault: string, options: DaemonGraphSyncOptions): Promise<void> {
  const syncFn: DaemonGraphSyncFn = options.syncFn ?? refreshMainGraphFromDaemon
  const intervalMs: number = options.pollIntervalMs ?? DAEMON_GRAPH_POLL_INTERVAL_MS
  const failureThreshold: number = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD

  if (state.activeVault === vault && state.pollTimer) {
    await syncOnce(state, vault, syncFn)
    return
  }

  await stopSync(state)
  activateState(state, vault, syncFn, failureThreshold)
  await syncOnce(state, vault, syncFn)
  startPollTimer(state, intervalMs)
}

function setSyncTier(state: DaemonGraphSyncState, tier: AppActivityTier): void {
  if (!state.activeVault || !state.activeSyncFn) return
  startPollTimer(state, TIER_INTERVALS[tier])
  if (tier === 'active') {
    void syncOnce(state, state.activeVault, state.activeSyncFn).catch(() => {})
  }
}

async function stopSync(state: DaemonGraphSyncState): Promise<void> {
  if (state.pollTimer) {
    clearInterval(state.pollTimer)
    state.pollTimer = null
  }

  state.activeVault = null
  state.activeSyncFn = null
  state.consecutiveFailures = 0

  const pendingSync = state.inflightSync
  if (pendingSync) {
    try {
      await pendingSync
    } catch {
      // Start-up and teardown callers decide whether the initial sync failure is fatal.
    }
  }
}

function createDaemonGraphSyncController(): DaemonGraphSyncController {
  const state: DaemonGraphSyncState = createDaemonGraphSyncState()

  return {
    isActive: () => state.activeVault !== null,
    setTier: (tier: AppActivityTier) => setSyncTier(state, tier),
    start: (vault: string, options: DaemonGraphSyncOptions = {}) => startSync(state, vault, options),
    stop: () => stopSync(state),
  }
}

const daemonGraphSync: DaemonGraphSyncController = createDaemonGraphSyncController()

export async function startDaemonGraphSync(
  vault: string,
  options: DaemonGraphSyncOptions = {},
): Promise<void> {
  return daemonGraphSync.start(vault, options)
}

export function setDaemonGraphSyncTier(tier: AppActivityTier): void {
  daemonGraphSync.setTier(tier)
}

export async function stopDaemonGraphSync(): Promise<void> {
  return daemonGraphSync.stop()
}

export function isDaemonGraphSyncActive(): boolean {
  return daemonGraphSync.isActive()
}
