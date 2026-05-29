export interface WatchFolderConfig {
    readonly writeFolderPath: string;
    readonly allowlist: readonly string[];
}

export interface VaultConfigPlan {
    readonly config: WatchFolderConfig;
    readonly shouldPersist: boolean;
}

export function decideVaultConfig(
    savedConfig: WatchFolderConfig | null,
    derivedWriteFolderPath: string,
    derivedAllowlist: readonly string[],
): VaultConfigPlan {
    if (savedConfig) {
        return { config: savedConfig, shouldPersist: false };
    }
    return {
        config: { writeFolderPath: derivedWriteFolderPath, allowlist: derivedAllowlist },
        shouldPersist: true,
    };
}
