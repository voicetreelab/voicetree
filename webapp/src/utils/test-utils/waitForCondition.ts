/**
 * Efficiently wait for a condition to become true.
 *
 * Uses short polling intervals optimized for file watcher timing:
 * - Chokidar awaitWriteFinish: 100ms stability threshold
 * - Expected file detection: 100-200ms
 * - Default max wait: 1000ms (reasonable for file system operations)
 *
 * @param condition - Function that returns true when desired state is reached
 * @param options - Configuration for polling behavior
 * @returns Promise that resolves when condition is true
 * @throws Error if condition not met within maxWaitMs
 */
export async function waitForCondition(
  condition: () => boolean,
  options: {
    readonly maxWaitMs?: number
    readonly pollIntervalMs?: number
    readonly errorMessage?: string
  } = {}
): Promise<void> {
  const maxWaitMs: number = options.maxWaitMs ?? 1000
  const pollIntervalMs: number = options.pollIntervalMs ?? 50
  const errorMessage: string = options.errorMessage ?? 'Condition not met within timeout'

  const startTime: number = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    if (condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`${errorMessage} (waited ${maxWaitMs}ms)`)
}

/**
 * Wait for file watcher to stabilize after initialization.
 * Chokidar with ignoreInitial:true is ready almost immediately,
 * but we give a small buffer for the watcher to be fully set up.
 */
export async function waitForWatcherReady(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 100))
}

/**
 * Wait for file system event to be processed by chokidar.
 * Accounts for awaitWriteFinish stabilityThreshold (100ms) plus file read time.
 */
export async function waitForFSEvent(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 200))
}
