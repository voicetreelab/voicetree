/**
 * Config persistence for Voicetree.
 *
 * Handles reading/writing the voicetree-config.json file which stores:
 * - Last watched directory (for auto-open on launch)
 * - Per-directory vault configs (allowlist, write path)
 */

import path from "path";
import { promises as fs } from "fs";
import { homedir } from "os";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath } from '@vt/graph-model/graph';
import type { VaultConfig } from '@vt/graph-model/settings';

type PersistedVaultConfig = VaultConfig & {
    readonly readPaths?: unknown;
}

export interface VoiceTreeConfig {
    lastDirectory?: string;
    vaultConfig?: { [folderPath: string]: VaultConfig };
}

interface PersistedVoiceTreeConfig {
    readonly lastDirectory?: string;
    readonly vaultConfig?: { readonly [folderPath: string]: PersistedVaultConfig };
}

function preserveVaultConfig(config: PersistedVoiceTreeConfig): VoiceTreeConfig {
    const cleaned: VoiceTreeConfig = {};
    if (config.lastDirectory !== undefined) {
        cleaned.lastDirectory = config.lastDirectory;
    }
    if (config.vaultConfig !== undefined) {
        cleaned.vaultConfig = {};
        for (const [folderPath, vaultConfig] of Object.entries(config.vaultConfig)) {
            cleaned.vaultConfig[folderPath] = {
                writeFolder: vaultConfig.writeFolder,
                readPaths: Array.isArray(vaultConfig.readPaths)
                    ? vaultConfig.readPaths.filter((entry): entry is string => typeof entry === 'string')
                    : [],
            };
        }
    }
    return cleaned;
}

export function getConfigPath(): string {
    return path.join(resolveVaultConfigAppSupportPath(), 'voicetree-config.json');
}

function resolveVaultConfigAppSupportPath(): string {
    return process.env.VOICETREE_APP_SUPPORT ?? path.join(homedir(), '.voicetree');
}

async function loadPersistedConfig(appSupportPath: string): Promise<PersistedVoiceTreeConfig> {
    const configPath: string = path.join(appSupportPath, 'voicetree-config.json');
    try {
        const data: string = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data) as PersistedVoiceTreeConfig;
    } catch {
        return {};
    }
}

export async function loadConfig(): Promise<VoiceTreeConfig> {
    const appSupportPath: string = resolveVaultConfigAppSupportPath();
    return preserveVaultConfig(await loadPersistedConfig(appSupportPath));
}

export async function saveConfig(config: VoiceTreeConfig): Promise<void> {
    const appSupportPath: string = resolveVaultConfigAppSupportPath();
    const configPath: string = path.join(appSupportPath, 'voicetree-config.json');
    try {
        const cleanConfig: VoiceTreeConfig = preserveVaultConfig(config as PersistedVoiceTreeConfig);
        // Ensure parent directory exists (needed on first run or in tests)
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');
    } catch (error) {
        console.error('[saveConfig] FAILED to save config:', error);
        throw error;  // Propagate error so callers know save failed
    }
}

export async function getLastDirectory(): Promise<O.Option<FilePath>> {
    const config: VoiceTreeConfig = await loadConfig();
    return O.fromNullable(config.lastDirectory as FilePath | null | undefined);
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
    const config: PersistedVoiceTreeConfig = await loadPersistedConfig(resolveVaultConfigAppSupportPath());
    const vaultConfig: PersistedVaultConfig | undefined = config.vaultConfig?.[directoryPath];
    return vaultConfig !== undefined &&
        Object.prototype.hasOwnProperty.call(vaultConfig, 'readPaths');
}

export async function saveVaultConfigForDirectory(directoryPath: string, vaultConfig: VaultConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.vaultConfig ??= {};
    const existingConfig: VaultConfig | undefined = config.vaultConfig[directoryPath];
    config.vaultConfig[directoryPath] = {
        writeFolder: vaultConfig.writeFolder,
        readPaths: vaultConfig.readPaths ?? existingConfig?.readPaths ?? [],
    };
    await saveConfig(config);
}
