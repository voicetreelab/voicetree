export interface PatternProbe {
    readonly patternPath: string;
    readonly exists: boolean;
}

export interface AllowlistPlan {
    readonly allowlist: readonly string[];
    readonly pathsToMarkExpanded: readonly string[];
}

export function buildPatternAllowlist(
    subfolderPath: string,
    probes: readonly PatternProbe[],
    persistDefaultExpandedPaths: boolean,
): AllowlistPlan {
    const allowlist: string[] = [subfolderPath];
    const pathsToMarkExpanded: string[] = [];
    for (const probe of probes) {
        if (!probe.exists) continue;
        if (allowlist.includes(probe.patternPath)) continue;
        allowlist.push(probe.patternPath);
        if (persistDefaultExpandedPaths) {
            pathsToMarkExpanded.push(probe.patternPath);
        }
    }
    return {
        allowlist,
        pathsToMarkExpanded,
    };
}
