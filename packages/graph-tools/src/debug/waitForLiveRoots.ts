import type { State } from '@vt/graph-state'

interface LiveStateReader {
  getLiveState(): Promise<State>
}

interface WaitForLiveRootsOptions {
  readonly timeoutMs?: number
  readonly pollMs?: number
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_POLL_MS = 250

async function defaultSleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitForLiveStateWithRoots(
  reader: LiveStateReader,
  options: WaitForLiveRootsOptions = {},
): Promise<State> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? defaultSleep
  const deadline = now() + Math.max(0, timeoutMs)
  let lastState: State | null = null
  let lastError: unknown = null

  while (true) {
    try {
      const state = await reader.getLiveState()
      lastState = state
      lastError = null

      if (state.roots.loaded.size > 0) {
        return state
      }
    } catch (error) {
      lastError = error
    }

    if (now() >= deadline) {
      if (lastState) {
        return lastState
      }

      if (lastError instanceof Error) {
        throw lastError
      }

      throw new Error(String(lastError ?? 'timed out waiting for live state'))
    }

    await sleep(Math.max(0, pollMs))
  }
}
