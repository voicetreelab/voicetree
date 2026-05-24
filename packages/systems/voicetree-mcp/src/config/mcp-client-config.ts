/**
 * MCP Client Configuration
 *
 * Manages MCP config files in the watched directory so that
 * coding agents (Claude, Codex, OpenCode, etc.) connect to Voicetree's MCP server.
 *
 * Claude Code reads .mcp.json (JSON).
 * Codex reads .codex/config.toml (TOML).
 * OpenCode reads opencode.jsonc (JSONC with comments).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getMcpPort } from '../tools/agent-control/mcp-server';
import {getMcpProjectRoot} from './mcp-graph-bridge';

const VOICETREE_MCP_SERVER_NAME: 'voicetree' = 'voicetree' as const;

interface McpServerConfig {
    type: string;
    url: string;
}

interface McpJsonConfig {
    mcpServers?: Record<string, McpServerConfig>;
}

// ─── .mcp.json (Claude Code) ────────────────────────────────────────────────

/**
 * Get the path to .mcp.json in the watched directory
 */
async function getMcpJsonPath(): Promise<string | null> {
    const watchedDir: string | null = await getMcpProjectRoot();
    if (!watchedDir) {
        return null;
    }
    return path.join(watchedDir, '.mcp.json');
}

// All public helpers resolve the .mcp.json path EXACTLY once and pass it
// through to these I/O primitives. Re-resolving inside helpers would race
// with `shutdownActiveDaemonConnection` clearing the graph bridge during
// app quit: an outer call would obtain a valid path, then a follow-up
// write/read would observe a null path and fail.

async function readMcpJsonAt(mcpJsonPath: string): Promise<McpJsonConfig> {
    try {
        const content: string = await fs.readFile(mcpJsonPath, 'utf-8');
        return JSON.parse(content) as McpJsonConfig;
    } catch (_error) {
        // File doesn't exist or is invalid JSON - return empty config
        return {};
    }
}

async function writeMcpJsonAt(mcpJsonPath: string, config: McpJsonConfig): Promise<void> {
    const content: string = JSON.stringify(config, null, 2);
    await fs.writeFile(mcpJsonPath, content, 'utf-8');
}

/**
 * Check if Voicetree MCP integration is enabled in .mcp.json
 */
export async function isMcpIntegrationEnabled(): Promise<boolean> {
    const mcpJsonPath: string | null = await getMcpJsonPath();
    if (!mcpJsonPath) return false;
    const config: McpJsonConfig = await readMcpJsonAt(mcpJsonPath);
    return config.mcpServers?.[VOICETREE_MCP_SERVER_NAME] !== undefined;
}

/**
 * Enable Voicetree MCP integration by adding config to .mcp.json
 * Merges with existing config to preserve other MCP servers
 */
export async function enableMcpJsonIntegration(): Promise<void> {
    const mcpJsonPath: string | null = await getMcpJsonPath();
    if (!mcpJsonPath) {
        throw new Error('No watched directory - cannot write .mcp.json');
    }

    const config: McpJsonConfig = await readMcpJsonAt(mcpJsonPath);
    const port: number = getMcpPort();

    // Merge Voicetree server into existing config
    config.mcpServers = {
        ...config.mcpServers,
        [VOICETREE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `http://127.0.0.1:${port}/mcp`
        }
    };

    await writeMcpJsonAt(mcpJsonPath, config);
}

/**
 * Disable Voicetree MCP integration by removing config from .mcp.json
 * Preserves other MCP servers in the config.
 *
 * No-op when no watched directory exists: there is no .mcp.json to mutate,
 * therefore nothing to disable. This case occurs during app quit when the
 * graph bridge has already been torn down by `shutdownActiveDaemonConnection`.
 */
export async function disableMcpJsonIntegration(): Promise<void> {
    const mcpJsonPath: string | null = await getMcpJsonPath();
    if (!mcpJsonPath) return;

    const config: McpJsonConfig = await readMcpJsonAt(mcpJsonPath);

    if (config.mcpServers?.[VOICETREE_MCP_SERVER_NAME]) {
        delete config.mcpServers[VOICETREE_MCP_SERVER_NAME];

        // Clean up empty mcpServers object
        if (Object.keys(config.mcpServers).length === 0) {
            delete config.mcpServers;
        }

        await writeMcpJsonAt(mcpJsonPath, config);
    }
}

// ─── .codex/config.toml (Codex) ─────────────────────────────────────────────

/** Matches the [mcp_servers.voicetree] section and all its key-value lines */
const CODEX_VOICETREE_SECTION_RE: RegExp = /\[mcp_servers\.voicetree\]\s*\n(?:(?!\[)[^\n]*\n?)*/;

async function getCodexConfigPath(): Promise<string | null> {
    const watchedDir: string | null = await getMcpProjectRoot();
    if (!watchedDir) return null;
    return path.join(watchedDir, '.codex', 'config.toml');
}

async function readCodexConfig(): Promise<string> {
    const configPath: string | null = await getCodexConfigPath();
    if (!configPath) return '';
    try {
        return await fs.readFile(configPath, 'utf-8');
    } catch (_error) {
        return '';
    }
}

async function writeCodexConfig(content: string): Promise<void> {
    const configPath: string | null = await getCodexConfigPath();
    if (!configPath) throw new Error('No watched directory - cannot write .codex/config.toml');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, content, 'utf-8');
}

async function enableCodexMcpIntegration(): Promise<void> {
    let content: string = await readCodexConfig();
    const port: number = getMcpPort();
    const section: string = `[mcp_servers.voicetree]\nurl = "http://localhost:${port}/mcp"\n`;

    if (content.includes('[mcp_servers.voicetree]')) {
        content = content.replace(CODEX_VOICETREE_SECTION_RE, section);
    } else {
        content = content.trimEnd() + (content.length > 0 ? '\n\n' : '') + section;
    }

    await writeCodexConfig(content);
}

async function disableCodexMcpIntegration(): Promise<void> {
    let content: string = await readCodexConfig();
    if (!content.includes('[mcp_servers.voicetree]')) return;

    content = content.replace(CODEX_VOICETREE_SECTION_RE, '');
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    if (content.length === 0) {
        // Delete the file if nothing left
        const configPath: string | null = await getCodexConfigPath();
        if (configPath) {
            try { await fs.unlink(configPath); } catch (_e) { /* ignore */ }
        }
        return;
    }

    await writeCodexConfig(content + '\n');
}

/**
 * Enable the MCP configs that should track the current VoiceTree port whenever
 * the app starts or a project folder is loaded.
 */
export async function enableMcpClientIntegrations(): Promise<void> {
    await enableMcpJsonIntegration();
    await enableCodexMcpIntegration();
}

// ─── opencode.jsonc (OpenCode) ────────────────────────────────────────────────

interface OpencodeMcpServerConfig {
    type: 'remote' | 'local';
    url: string;
    enabled?: boolean;
}

interface OpencodeConfig {
    $schema?: string;
    mcp?: Record<string, OpencodeMcpServerConfig>;
    [key: string]: any; // Preserve other OpenCode settings
}

async function getOpencodeConfigPath(): Promise<string | null> {
    const watchedDir: string | null = await getMcpProjectRoot();
    if (!watchedDir) return null;
    return path.join(watchedDir, 'opencode.jsonc');
}

/**
 * Read the current opencode.jsonc config, or return empty config if doesn't exist
 */
async function readOpencodeConfig(): Promise<OpencodeConfig> {
    const configPath: string | null = await getOpencodeConfigPath();
    if (!configPath) {
        return {};
    }

    try {
        const content: string = await fs.readFile(configPath, 'utf-8');
        // Parse as JSON (JSONC is JSON with optional comments, JSON.parse ignores comments)
        return JSON.parse(content) as OpencodeConfig;
    } catch (_error) {
        // File doesn't exist or is invalid JSON - return empty config
        return {};
    }
}

/**
 * Write the opencode.jsonc config
 */
async function writeOpencodeConfig(config: OpencodeConfig): Promise<void> {
    const configPath: string | null = await getOpencodeConfigPath();
    if (!configPath) {
        throw new Error('No watched directory - cannot write opencode.jsonc');
    }

    const content: string = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, content, 'utf-8');
}

/**
 * Enable Voicetree MCP integration by adding config to opencode.jsonc
 * Merges with existing config to preserve other MCP servers and settings
 */
export async function enableOpencodeMcpIntegration(): Promise<void> {
    const config: OpencodeConfig = await readOpencodeConfig();
    const port: number = getMcpPort();

    // Ensure schema is present
    config.$schema ??= 'https://opencode.ai/config.json';

    // Ensure mcp section exists
    config.mcp ??= {};

    // Merge or update voicetree server config
    config.mcp[VOICETREE_MCP_SERVER_NAME] = {
        type: 'remote',
        url: `http://127.0.0.1:${port}/mcp`,
        enabled: true
    };

    await writeOpencodeConfig(config);
}

/**
 * Disable Voicetree MCP integration by removing config from opencode.jsonc
 * Preserves other MCP servers and settings in the config
 */
export async function disableOpencodeMcpIntegration(): Promise<void> {
    const config: OpencodeConfig = await readOpencodeConfig();

    if (config.mcp?.[VOICETREE_MCP_SERVER_NAME]) {
        delete config.mcp[VOICETREE_MCP_SERVER_NAME];

        // Clean up empty mcp object
        if (Object.keys(config.mcp).length === 0) {
            delete config.mcp;
        }

        // If only schema remains, delete the file
        const keys: string[] = Object.keys(config);
        if (keys.length === 0 || (keys.length === 1 && keys[0] === '$schema')) {
            const configPath: string | null = await getOpencodeConfigPath();
            if (configPath) {
                try { await fs.unlink(configPath); } catch (_e) { /* ignore */ }
            }
            return;
        }

        await writeOpencodeConfig(config);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

function isCodexAgent(agentCommand: string): boolean {
    return agentCommand.toLowerCase().includes('codex');
}

export function isOpencodeAgent(agentCommand: string): boolean {
    return agentCommand.toLowerCase().includes('opencode');
}

/**
 * Set MCP integration state for the appropriate config file(s).
 * Always writes .mcp.json and .codex/config.toml so they track the current port.
 * Also writes opencode.jsonc when agentCommand is an OpenCode agent.
 */
export async function setMcpIntegration(enabled: boolean, agentCommand?: string): Promise<void> {
    // Core client configs that should stay fresh for externally launched agents.
    if (enabled) {
        await enableMcpClientIntegrations();
    } else {
        await disableMcpJsonIntegration();
    }

    // Codex .codex/config.toml (conditional)
    if (agentCommand && isCodexAgent(agentCommand)) {
        if (enabled) {
            await enableCodexMcpIntegration();
        } else {
            await disableCodexMcpIntegration();
        }
    }

    // OpenCode opencode.jsonc (conditional)
    if (agentCommand && isOpencodeAgent(agentCommand)) {
        if (enabled) {
            await enableOpencodeMcpIntegration();
        } else {
            await disableOpencodeMcpIntegration();
        }
    }
}
