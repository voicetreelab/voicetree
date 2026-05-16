export * from './pure/settings'
export type { HotkeyModifier, HotkeyBinding, HotkeySettings, HookSettings, PtyBackend, VaultConfig, VoiceTreeConfig } from './pure/settings/types'
export { getUniqueAgentName } from './pure/settings/types'
export { SETTINGS_SCHEMA, DEFAULT_HOTKEYS, type Section, type NumberFieldConfig } from './pure/settings/settingsSchema'
