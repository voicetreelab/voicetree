import type {EnvVarValue} from "@/pure/settings/types";

/**
 * Normalize env var value by collapsing whitespace to single spaces.
 * Prevents env var issues on Windows where newlines break PowerShell parsing.
 */
function normalizeEnvValue(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
}

/**
 * Resolve env var definitions to concrete string values.
 * For arrays, randomly selects one element.
 * All values are normalized (newlines collapsed) for cross-platform compatibility.
 */
export function resolveEnvVars(envVarDefs: Record<string, EnvVarValue>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(envVarDefs).map(([key, value]: readonly [string, EnvVarValue]): readonly [string, string] => {
            if (typeof value === 'string') {
                return [key, normalizeEnvValue(value)];
            }
            const randomIndex: number = Math.floor(Math.random() * value.length);
            return [key, normalizeEnvValue(value[randomIndex])];
        })
    );
}

/**
 * Expand $VAR_NAME references within env var values using other vars in the same record.
 * This allows AGENT_PROMPT to reference $AGENT_PROMPT_CORE, which itself references $CONTEXT_NODE_PATH, etc.
 * Iterates until no more expansions occur (max 5 passes to prevent infinite loops).
 */
export function expandEnvVarsInValues(envVars: Record<string, string>): Record<string, string> {
    let current: Record<string, string> = envVars;
    for (let pass: number = 0; pass < 5; pass++) {
        let changed: boolean = false;
        const next: Record<string, string> = Object.fromEntries(
            Object.entries(current).map(([key, value]: readonly [string, string]): readonly [string, string] => {
                const expanded: string = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match: string, varName: string): string => {
                    return current[varName] ?? `$${varName}`;
                });
                if (expanded !== value) {
                    changed = true;
                }
                return [key, expanded];
            })
        );
        current = next;
        if (!changed) {
            break;
        }
    }
    return current;
}