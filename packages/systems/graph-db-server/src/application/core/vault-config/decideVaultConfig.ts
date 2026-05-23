export interface WatchFolderConfig {
    readonly writePath: string;
    readonly allowlist: readonly string[];
}

export interface VaultConfigPlan {
    readonly config: WatchFolderConfig;
    readonly shouldPersist: boolean;
}

export function decideVaultConfig(
    savedConfig: WatchFolderConfig | null,
    derivedWritePath: string,
    derivedAllowlist: readonly string[],
): VaultConfigPlan {
    if (savedConfig) {
        return { config: savedConfig, shouldPersist: false };
    }
    return {
        config: { writePath: derivedWritePath, allowlist: derivedAllowlist },
        shouldPersist: true,
    };
}
