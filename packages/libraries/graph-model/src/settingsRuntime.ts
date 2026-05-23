import {
    createDefaultSettings,
    createSettingsSchema,
    defaultHotkeysForPlatform,
    platformFromBrowserText,
    type SettingsRuntime,
} from './pure/settings/settingsSchema';

const runtimeNavigator: {
    readonly userAgentData?: { readonly platform?: string };
    readonly platform?: string;
    readonly userAgent?: string;
} | undefined = (globalThis as {
    readonly navigator?: {
        readonly userAgentData?: { readonly platform?: string };
        readonly platform?: string;
        readonly userAgent?: string;
    };
}).navigator;

const browserPlatform: string = [
    runtimeNavigator?.userAgentData?.platform,
    runtimeNavigator?.platform,
    runtimeNavigator?.userAgent,
].filter(Boolean).join(' ');

const runtimePlatform: string | undefined = typeof process !== 'undefined' && process.platform
    ? process.platform
    : platformFromBrowserText(browserPlatform);

const runtime: SettingsRuntime = {
    platform: runtimePlatform,
    homeDir: typeof process !== 'undefined' ? process.env.HOME : undefined,
};

export const DEFAULT_HOTKEYS = defaultHotkeysForPlatform(runtime.platform);
export const SETTINGS_SCHEMA = createSettingsSchema(runtime);
export const DEFAULT_SETTINGS = createDefaultSettings(runtime);
