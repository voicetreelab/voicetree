import type {VTSettings} from "@/pure/settings";

// The ONLY mutable state for settings cache in the functional architecture
// Initialized to null - will be populated when settings are loaded
// eslint-disable-next-line functional/no-let
let cachedSettings: VTSettings | null = null;

// Getter/setter for controlled access to settings cache
export const getCachedSettings = (): VTSettings | null => {
    return cachedSettings;
};

export const setCachedSettings = (settings: VTSettings): void => {
    cachedSettings = settings;
};

export const clearCachedSettings = (): void => {
    cachedSettings = null;
};
