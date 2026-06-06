import { getUniqueAgentName, AGENT_ID_HASH_LENGTH, AGENT_ID_HASH_ALPHABET } from './pure/settings/types'

export type { VTSettings, AgentConfig, EnvVarValue, HotkeyModifier, HotkeyBinding, HotkeySettings, HookSettings, ProjectConfig, VoiceTreeConfig, TerminalScrollStrategy } from './pure/settings/types'
export { getUniqueAgentName, agentBaseName, formatAgentId, AGENT_ID_SEPARATOR, AGENT_ID_HASH_LENGTH, AGENT_ID_HASH_ALPHABET } from './pure/settings/types'
export { DEFAULT_SUBGRAPH_WARN_THRESHOLD, DEFAULT_SUBGRAPH_ERROR_THRESHOLD, DEFAULT_MAX_CHILDREN_PER_NODE, DEFAULT_COMPLEXITY_WARN_SCORE, DEFAULT_COMPLEXITY_BLOCK_SCORE, DEFAULT_SUBGRAPH_LIMITS } from './pure/settings/types'
export { AGENT_NAMES, getNextAgentName } from './pure/settings/types'
export {
    type ResolvedAgent,
    flattenAgentTree,
    resolveDefaultAgent,
    mapAgentTreeByCommand,
} from './pure/settings/agentTree'

function randomAgentHash(): string {
    return Array.from(
        { length: AGENT_ID_HASH_LENGTH },
        () => AGENT_ID_HASH_ALPHABET[Math.floor(Math.random() * AGENT_ID_HASH_ALPHABET.length)],
    ).join('');
}

export function uniqueAgentName(baseName: string, existingNames: ReadonlySet<string>): string {
    return getUniqueAgentName(baseName, existingNames, randomAgentHash);
}
export {
    type Persona,
    SILICON_VALLEY_ROSTER,
    SILICON_VALLEY_IDS,
    lookupPersona,
    renderPersonaSoul,
    getAgentNamePool,
    pickAgentName,
    appendPersonaToAgentPrompt,
} from './pure/agents/siliconValleyRoster'
export { expandEnvVarsInValues, resolveEnvVars, resolveEnvVarsWithSelection } from './pure/settings/resolve-environment-variable'
export { isReservedAgentPromptEnvKey } from './pure/settings/promptEnvKeys'
export {
    agentPromptVariableForPlatform,
    createDefaultSettings,
    createSettingsSchema,
    defaultHotkeysForPlatform,
    platformFromBrowserText,
    type NumberFieldConfig,
    type SelectOption,
    type Section,
    type SettingsRuntime,
} from './pure/settings/settingsSchema'
export { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, SETTINGS_SCHEMA } from './pure/settings/settingsRuntime'
