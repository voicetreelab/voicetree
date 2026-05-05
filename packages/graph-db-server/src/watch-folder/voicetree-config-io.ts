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
import type { FilePath } from '@vt/graph-model/pure/graph';
import type { VaultConfig } from '@vt/graph-model/pure/settings/types';
import {getConfig} from '@vt/graph-model';

type PersistedVaultConfig = VaultConfig & {
    readonly readPaths?: unknown;
}

export interface VoiceTreeConfig {
    lastDirectory?: string;
    vaultConfig?: { [folderPath: string]: PersistedVaultConfig };
}

export function getConfigPath(): string {
    return path.join(getConfig().appSupportPath, 'voicetree-config.json');
}

export async function loadConfig(): Promise<VoiceTreeConfig> {
    const configPath: string = getConfigPath();
    try {
        const data: string = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data) as VoiceTreeConfig;
    } catch {
        return {};
    }
}

export async function saveConfig(config: VoiceTreeConfig): Promise<void> {
    const configPath: string = getConfigPath();
    try {
        // Ensure parent directory exists (needed on first run or in tests)
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
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
    const config: VoiceTreeConfig = await loadConfig();
    const vaultConfig: PersistedVaultConfig | undefined = config.vaultConfig?.[directoryPath];
    return vaultConfig !== undefined &&
        Object.prototype.hasOwnProperty.call(vaultConfig, 'readPaths') &&
        Array.isArray((vaultConfig as { readPaths?: unknown }).readPaths) &&
        ((vaultConfig as { readPaths: readonly unknown[] }).readPaths.length > 0);
}

export async function saveVaultConfigForDirectory(directoryPath: string, vaultConfig: VaultConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.vaultConfig ??= {};
    // readPaths: [] is a forward-compatibility shim for older packaged binaries
    // (pre-BF-241) that iterate this field on load. New code ignores it.
    config.vaultConfig[directoryPath] = {
        writePath: vaultConfig.writePath,
        readPaths: [],
    };
    await saveConfig(config);
}
