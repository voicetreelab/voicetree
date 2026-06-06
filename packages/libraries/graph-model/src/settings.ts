import { getUniqueAgentName, AGENT_ID_HASH_LENGTH } from './pure/settings/types'

export type { VTSettings, AgentConfig, EnvVarValue, HotkeyModifier, HotkeyBinding, HotkeySettings, HookSettings, ProjectConfig, VoiceTreeConfig, TerminalScrollStrategy } from './pure/settings/types'
export { getUniqueAgentName, agentBaseName, formatAgentId, AGENT_ID_SEPARATOR, AGENT_ID_HASH_LENGTH } from './pure/settings/types'
export { DEFAULT_SUBGRAPH_WARN_THRESHOLD, DEFAULT_SUBGRAPH_ERROR_THRESHOLD } from './pure/settings/types'

// Impure edge of the agent-id pipeline — kept here, OUT of pure/, because it
// reads Math.random. `getUniqueAgentName` stays pure by taking the generator as
// a parameter; pure callers and tests inject a deterministic source instead. The
// suffix matcher in pure/settings/types.ts expects [a-z0-9]{AGENT_ID_HASH_LENGTH},
// so this alphabet must stay [a-z0-9].
const AGENT_ID_HASH_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomAgentHash(): string {
    return Array.from(
        { length: AGENT_ID_HASH_LENGTH },
        () => AGENT_ID_HASH_ALPHABET[Math.floor(Math.random() * AGENT_ID_HASH_ALPHABET.length)],
    ).join('')
}

/**
 * Edge wrapper: allocate a collision-free agent id using the real random hash
 * source. Pure callers and tests use `getUniqueAgentName` directly with an
 * injected deterministic generator.
 */
export function allocateUniqueAgentId(baseName: string, existingNames: ReadonlySet<string>): string {
    return getUniqueAgentName(baseName, existingNames, randomAgentHash)
}
export { AGENT_NAMES, getNextAgentName, getDefaultAgent } from './pure/settings/types'
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
