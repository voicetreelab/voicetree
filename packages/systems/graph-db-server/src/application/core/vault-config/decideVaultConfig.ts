export interface WatchFolderConfig {
    readonly writeFolder: string;
    readonly allowlist: readonly string[];
}

export interface VaultConfigPlan {
    readonly config: WatchFolderConfig;
    readonly shouldPersist: boolean;
}

export function decideVaultConfig(
    savedConfig: WatchFolderConfig | null,
    derivedWriteFolder: string,
    derivedAllowlist: readonly string[],
): VaultConfigPlan {
    if (savedConfig) {
        return { config: savedConfig, shouldPersist: false };
    }
    return {
        config: { writeFolder: derivedWriteFolder, allowlist: derivedAllowlist },
        shouldPersist: true,
    };
}
