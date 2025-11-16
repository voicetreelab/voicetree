import type {Settings} from "@/pure/settings";

// The ONLY mutable state for settings cache in the functional architecture
// Initialized to null - will be populated when settings are loaded
// eslint-disable-next-line functional/no-let
let cachedSettings: Settings | null = null;

// Getter/setter for controlled access to settings cache
export const getCachedSettings = (): Settings | null => {
    return cachedSettings;
};

export const setCachedSettings = (settings: Settings): void => {
    cachedSettings = settings;
};

export const clearCachedSettings = (): void => {
    cachedSettings = null;
};
