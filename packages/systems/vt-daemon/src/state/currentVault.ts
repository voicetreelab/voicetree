/**
 * BF-379 · Phase 3 — daemon-process active vault accessor.
 *
 * vt-daemon serves exactly one vault per process. The active vault is set
 * once at boot (by `bin/vt-mcpd.ts` from `--vault`, by Electron's
 * `http-server-binding.ts` from the opened vault path) and read by tools
 * that need to address daemon-owned per-vault state.
 *
 * Module-scope state is appropriate because the binding is process-scoped,
 * not call-scoped — every tool invocation on this process resolves to the
 * same vault.
 */
let currentVault: string | null = null

export function setCurrentVault(vault: string | null): void {
    currentVault = vault
}

export function getCurrentVault(): string {
    if (currentVault === null) {
        throw new Error(
            'No active vault: setCurrentVault must be called by the daemon host '
            + '(bin/vt-mcpd.ts or webapp http-server-binding.ts) before invoking '
            + 'tools that touch session state.',
        )
    }
    return currentVault
}

export function peekCurrentVault(): string | null {
    return currentVault
}

export function __resetCurrentVaultForTests(): void {
    currentVault = null
}
