export type SpawnTerminalLogger = {
    error(message?: unknown, ...optionalParams: unknown[]): void
    warn(message?: unknown, ...optionalParams: unknown[]): void
}

export type SpawnTerminalDeps = {
    logger: SpawnTerminalLogger
}

export const defaultSpawnTerminalDeps: SpawnTerminalDeps = {
    logger: { error: console.error, warn: console.warn },
}
