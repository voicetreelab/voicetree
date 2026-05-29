/**
 * Config persistence for Voicetree.
 *
 * Handles reading/writing the voicetree-config.json file which stores:
 * - Last watched directory (for auto-open on launch)
 * - Per-directory project configs (allowlist, write path)
 */

import path from "path";
import { promises as fs } from "fs";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath } from '@vt/graph-model/graph';
import type { ProjectConfig } from '@vt/graph-model/settings';
import {resolveVoicetreeHomePath} from '@vt/paths';

type PersistedProjectConfig = ProjectConfig & {
    readonly readPaths?: unknown;
}

export interface VoiceTreeConfig {
    lastDirectory?: string;
    projectConfig?: { [folderPath: string]: ProjectConfig };
}

interface PersistedVoiceTreeConfig {
    readonly lastDirectory?: string;
    readonly projectConfig?: { readonly [folderPath: string]: PersistedProjectConfig };
}

function preserveProjectConfig(config: PersistedVoiceTreeConfig): VoiceTreeConfig {
    const cleaned: VoiceTreeConfig = {};
    if (config.lastDirectory !== undefined) {
        cleaned.lastDirectory = config.lastDirectory;
    }
    if (config.projectConfig !== undefined) {
        cleaned.projectConfig = {};
        for (const [folderPath, projectConfig] of Object.entries(config.projectConfig)) {
            cleaned.projectConfig[folderPath] = {
                writeFolderPath: projectConfig.writeFolderPath,
                readPaths: Array.isArray(projectConfig.readPaths)
                    ? projectConfig.readPaths.filter((entry): entry is string => typeof entry === 'string')
                    : [],
            };
        }
    }
    return cleaned;
}

export function getConfigPath(): string {
    return path.join(resolveVoicetreeHomePath(), 'voicetree-config.json');
}

async function loadPersistedConfig(voicetreeHomePath: string): Promise<PersistedVoiceTreeConfig> {
    const configPath: string = path.join(voicetreeHomePath, 'voicetree-config.json');
    try {
        const data: string = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data) as PersistedVoiceTreeConfig;
    } catch {
        return {};
    }
}

export async function loadConfig(): Promise<VoiceTreeConfig> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    return preserveProjectConfig(await loadPersistedConfig(voicetreeHomePath));
}

export async function saveConfig(config: VoiceTreeConfig): Promise<void> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    const configPath: string = path.join(voicetreeHomePath, 'voicetree-config.json');
    try {
        const cleanConfig: VoiceTreeConfig = preserveProjectConfig(config as PersistedVoiceTreeConfig);
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

export async function getProjectConfigForDirectory(directoryPath: string): Promise<ProjectConfig | undefined> {
    const config: VoiceTreeConfig = await loadConfig();
    return config.projectConfig?.[directoryPath];
}

export async function hasLegacyReadPathsForDirectory(directoryPath: string): Promise<boolean> {
    const config: PersistedVoiceTreeConfig = await loadPersistedConfig(resolveVoicetreeHomePath());
    const projectConfig: PersistedProjectConfig | undefined = config.projectConfig?.[directoryPath];
    return projectConfig !== undefined &&
        Object.prototype.hasOwnProperty.call(projectConfig, 'readPaths');
}

export async function saveProjectConfigForDirectory(directoryPath: string, projectConfig: ProjectConfig): Promise<void> {
    const config: VoiceTreeConfig = await loadConfig();
    config.projectConfig ??= {};
    const existingConfig: ProjectConfig | undefined = config.projectConfig[directoryPath];
    config.projectConfig[directoryPath] = {
        writeFolderPath: projectConfig.writeFolderPath,
        readPaths: projectConfig.readPaths ?? existingConfig?.readPaths ?? [],
    };
    await saveConfig(config);
}
