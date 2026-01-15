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
        Object.entries(envVarDefs).map(([key, value]: [string, EnvVarValue]): [string, string] => {
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
 * This allows AGENT_PROMPT to reference $CONTEXT_NODE_CONTENT, etc.
 */
export function expandEnvVarsInValues(envVars: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(envVars).map(([key, value]: [string, string]): [string, string] => {
            const expanded: string = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match: string, varName: string): string => {
                return envVars[varName] ?? `$${varName}`;
            });
            return [key, expanded];
        })
    );
}