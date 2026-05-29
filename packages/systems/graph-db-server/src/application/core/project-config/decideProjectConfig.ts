export interface WatchFolderConfig {
    readonly writeFolderPath: string;
    readonly allowlist: readonly string[];
}

export interface ProjectConfigPlan {
    readonly config: WatchFolderConfig;
    readonly shouldPersist: boolean;
}

export function decideProjectConfig(
    savedConfig: WatchFolderConfig | null,
    derivedWriteFolderPath: string,
    derivedAllowlist: readonly string[],
): ProjectConfigPlan {
    if (savedConfig) {
        return { config: savedConfig, shouldPersist: false };
    }
    return {
        config: { writeFolderPath: derivedWriteFolderPath, allowlist: derivedAllowlist },
        shouldPersist: true,
    };
}
