export type { VTSettings, AgentConfig, EnvVarValue, HotkeyModifier, HotkeyBinding, HotkeySettings, HookSettings, ProjectConfig, VoiceTreeConfig } from './pure/settings/types'
export { getUniqueAgentName } from './pure/settings/types'
export { AGENT_NAMES, getNextAgentName, getDefaultAgent } from './pure/settings/types'
export { expandEnvVarsInValues, resolveEnvVars, resolveEnvVarsWithSelection } from './pure/settings/resolve-environment-variable'
export {
    agentPromptVariableForPlatform,
    createDefaultSettings,
    createSettingsSchema,
    defaultHotkeysForPlatform,
    platformFromBrowserText,
    type NumberFieldConfig,
    type Section,
    type SettingsRuntime,
} from './pure/settings/settingsSchema'
export { DEFAULT_HOTKEYS, DEFAULT_SETTINGS, SETTINGS_SCHEMA } from './pure/settings/settingsRuntime'
