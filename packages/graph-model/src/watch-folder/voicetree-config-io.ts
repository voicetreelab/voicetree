/**
 * Config persistence for Voicetree.
 *
 * Handles reading/writing the voicetree-config.json file which stores:
 * - Last watched directory (for auto-open on launch)
 * - Per-directory vault configs (allowlist, write path)
 */

import path from "path";
import { promises as fs } from "fs";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath } from '../pure/graph';
import type { VaultConfig } from '../pure/settings/types';
import {getConfig} from '../types';

export interface VoiceTreeConfig {
    lastDirectory?: string;
    vaultConfig?: { [folderPath: string]: VaultConfig };
}

type LegacyVaultConfig = VaultConfig & {
    readonly readPaths?: unknown;
}

interface PersistedVoiceTreeConfig {
    readonly lastDirectory?: string;
    readonly vaultConfig?: { readonly [folderPath: string]: LegacyVaultConfig };
}

function stripLegacyVaultConfig(config: PersistedVoiceTreeConfig): VoiceTreeConfig {
    const cleaned: VoiceTreeConfig = {};
    if (config.lastDirectory !== undefined) {
        cleaned.lastDirectory = config.lastDirectory;
    }
    if (config.vaultConfig !== undefined) {
        cleaned.vaultConfig = {};
        for (const [folderPath, vaultConfig] of Object.entries(config.vaultConfig)) {
            cleaned.vaultConfig[folderPath] = {
                writePath: vaultConfig.writePath,
            };
        }
    }
    return cleaned;
}

export function getConfigPath(): string {
    return path.join(getConfig().appSupportPath, 'voicetree-config.json');
}

async function loadPersistedConfig(): Promise<PersistedVoiceTreeConfig> {
    const configPath: string = getConfigPath();
    try {
        const data: string = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data) as PersistedVoiceTreeConfig;
    } catch {
        return {};
    }
}

export async function loadConfig(): Promise<VoiceTreeConfig> {
    return stripLegacyVaultConfig(await loadPersistedConfig());
}

export async function saveConfig(config: VoiceTreeConfig): Promise<void> {
    const configPath: string = getConfigPath();
    try {
        const cleanConfig: VoiceTreeConfig = stripLegacyVaultConfig(config as PersistedVoiceTreeConfig);
        // Ensure parent directory exists (needed on first run or in tests)
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');
    } catch (error) {
        console.error('[saveConfig] FAILED to save config:', error);
        throw error;  // Propagate error so callers know save failed
    }
}

export async function getLastDirectory(): Promise<O.Option<FilePath>> {
    const configPath: string = getConfigPath();
    return fs.readFile(configPath, 'utf8')
        .then(data => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const config: any = JSON.parse(data);
            return O.fromNullable(config.lastDirectory as FilePath | null | undefined);
        })
        .catch((error) => {
            console.error("getLastDirectory", error);
            // Config file doesn't exist yet (first run) - return None
            return O.none;
        });
}

export async function saveLastDirectory(directoryPath: string): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.lastDirectory = directoryPath;
    await saveConfig(config);
}

export async function getVaultConfigForDirectory(directoryPath: string): Promise<VaultConfig | undefined> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.vaultConfig?.[directoryPath];
}

export async function hasLegacyReadPathsForDirectory(directoryPath: string): Promise<boolean> {
    const config: PersistedVoiceTreeConfig = await loadPersistedConfig();
    const vaultConfig: LegacyVaultConfig | undefined = config.vaultConfig?.[directoryPath];
    return vaultConfig !== undefined &&
        Object.prototype.hasOwnProperty.call(vaultConfig, 'readPaths');
}

export async function saveVaultConfigForDirectory(directoryPath: string, vaultConfig: VaultConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.vaultConfig ??= {};
    config.vaultConfig[directoryPath] = {
        writePath: vaultConfig.writePath,
    };
    await saveConfig(config);
}
