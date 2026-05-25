// Daemon-side gate that blocks vault-scoped reads while an `openVaultWorkflow`
// is mid-flight. Without it, callers landing between the moment a fresh open
// begins and the moment `projectRoot` is set throw `VaultNotOpenError` even
// though a vault IS being opened — surfacing as a 409 to the renderer mid
// vault-switch.
//
// Contract:
//   - `beginVaultOpen` installs a fresh unresolved promise.
//   - `completeVaultOpen` resolves it and clears the slot.
//   - `awaitVaultOpenReady(timeoutMs)` waits for an in-flight open with a bounded
//     timeout; falls through (resolves) when no open is pending or on timeout.
//   - `resetVaultOpenGate` releases waiters during daemon teardown.
//
// State mutation is pushed to the edges (`beginVaultOpen`/`completeVaultOpen`
// called by `openVaultWorkflow`'s mutex body). The awaiter is a pure read of
// the current pending promise.

type Gate = {
    readonly pending: Promise<void>
    readonly resolve: () => void
}

let gate: Gate | null = null

export function beginVaultOpen(): void {
    if (gate) {
        // Release any prior waiters before installing a fresh slot. The vault
        // mutex serializes opens so this branch is defensive; without it, the
        // previous promise would be silently orphaned and its waiters would
        // hang until their own timeout fired.
        gate.resolve()
    }
    let resolve: () => void = () => {}
    const pending = new Promise<void>((r): void => {
        resolve = r
    })
    gate = { pending, resolve }
}

export function completeVaultOpen(): void {
    const current = gate
    if (!current) return
    gate = null
    current.resolve()
}

export async function awaitVaultOpenReady(timeoutMs: number): Promise<void> {
    const current = gate
    if (!current) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve): void => {
        timer = setTimeout(resolve, timeoutMs)
    })

    try {
        await Promise.race([current.pending, timeout])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

export function resetVaultOpenGate(): void {
    const current = gate
    if (!current) return
    gate = null
    current.resolve()
}
