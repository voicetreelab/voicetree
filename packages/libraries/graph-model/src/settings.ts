export type { VTSettings, AgentConfig, EnvVarValue, HotkeyModifier, HotkeyBinding, HotkeySettings, HookSettings, ProjectConfig, VoiceTreeConfig, TerminalScrollStrategy } from './pure/settings/types'
export { getUniqueAgentName } from './pure/settings/types'
export { DEFAULT_SUBGRAPH_WARN_THRESHOLD, DEFAULT_SUBGRAPH_ERROR_THRESHOLD, DEFAULT_MAX_CHILDREN_PER_NODE, DEFAULT_COMPLEXITY_WARN_SCORE, DEFAULT_COMPLEXITY_BLOCK_SCORE } from './pure/settings/types'
export { AGENT_NAMES, getNextAgentName, getDefaultAgent } from './pure/settings/types'
export {
    type Persona,
    SILICON_VALLEY_ROSTER,
    SILICON_VALLEY_IDS,
    baseIdFromAgentName,
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
