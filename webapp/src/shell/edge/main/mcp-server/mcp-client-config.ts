/**
 * MCP Client Configuration
 *
 * Manages MCP config files in the watched directory so that
 * coding agents (Claude, Codex, etc.) connect to Voicetree's MCP server.
 *
 * Claude Code reads .mcp.json (JSON).
 * Codex reads .codex/config.toml (TOML).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getMcpPort } from './mcp-server';
import {getProjectRootWatchedDirectory} from "@/shell/edge/main/state/watch-folder-store";

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
function getMcpJsonPath(): string | null {
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return null;
    }
    return path.join(watchedDir, '.mcp.json');
}

/**
 * Read the current .mcp.json config, or return empty config if doesn't exist
 */
async function readMcpJson(): Promise<McpJsonConfig> {
    const mcpJsonPath: string | null = getMcpJsonPath();
    if (!mcpJsonPath) {
        return {};
    }

    try {
        const content: string = await fs.readFile(mcpJsonPath, 'utf-8');
        return JSON.parse(content) as McpJsonConfig;
    } catch (_error) {
        // File doesn't exist or is invalid JSON - return empty config
        return {};
    }
}

/**
 * Write the .mcp.json config
 */
async function writeMcpJson(config: McpJsonConfig): Promise<void> {
    const mcpJsonPath: string | null = getMcpJsonPath();
    if (!mcpJsonPath) {
        throw new Error('No watched directory - cannot write .mcp.json');
    }

    const content: string = JSON.stringify(config, null, 2);
    await fs.writeFile(mcpJsonPath, content, 'utf-8');
}

/**
 * Check if Voicetree MCP integration is enabled in .mcp.json
 */
export async function isMcpIntegrationEnabled(): Promise<boolean> {
    const config: McpJsonConfig = await readMcpJson();
    return config.mcpServers?.[VOICETREE_MCP_SERVER_NAME] !== undefined;
}

/**
 * Enable Voicetree MCP integration by adding config to .mcp.json
 * Merges with existing config to preserve other MCP servers
 */
async function enableMcpJsonIntegration(): Promise<void> {
    const config: McpJsonConfig = await readMcpJson();
    const port: number = getMcpPort();

    // Merge Voicetree server into existing config
    config.mcpServers = {
        ...config.mcpServers,
        [VOICETREE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `http://localhost:${port}/mcp`
        }
    };

    await writeMcpJson(config);
}

/**
 * Disable Voicetree MCP integration by removing config from .mcp.json
 * Preserves other MCP servers in the config
 */
async function disableMcpJsonIntegration(): Promise<void> {
    const config: McpJsonConfig = await readMcpJson();

    if (config.mcpServers?.[VOICETREE_MCP_SERVER_NAME]) {
        delete config.mcpServers[VOICETREE_MCP_SERVER_NAME];

        // Clean up empty mcpServers object
        if (Object.keys(config.mcpServers).length === 0) {
            delete config.mcpServers;
        }

        await writeMcpJson(config);
    }
}

// ─── .codex/config.toml (Codex) ─────────────────────────────────────────────

/** Matches the [mcp_servers.voicetree] section and all its key-value lines */
const CODEX_VOICETREE_SECTION_RE: RegExp = /\[mcp_servers\.voicetree\]\s*\n(?:(?!\[)[^\n]*\n?)*/;

function getCodexConfigPath(): string | null {
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return null;
    return path.join(watchedDir, '.codex', 'config.toml');
}

async function readCodexConfig(): Promise<string> {
    const configPath: string | null = getCodexConfigPath();
    if (!configPath) return '';
    try {
        return await fs.readFile(configPath, 'utf-8');
    } catch (_error) {
        return '';
    }
}

async function writeCodexConfig(content: string): Promise<void> {
    const configPath: string | null = getCodexConfigPath();
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
        const configPath: string | null = getCodexConfigPath();
        if (configPath) {
            try { await fs.unlink(configPath); } catch (_e) { /* ignore */ }
        }
        return;
    }

    await writeCodexConfig(content + '\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

function isCodexAgent(agentCommand: string): boolean {
    return agentCommand.toLowerCase().includes('codex');
}

/**
 * Set MCP integration state for the appropriate config file(s).
 * Always writes .mcp.json. Also writes .codex/config.toml when agentCommand is a Codex agent.
 */
export async function setMcpIntegration(enabled: boolean, agentCommand?: string): Promise<void> {
    if (enabled) {
        await enableMcpJsonIntegration();
    } else {
        await disableMcpJsonIntegration();
    }

    if (agentCommand && isCodexAgent(agentCommand)) {
        if (enabled) {
            await enableCodexMcpIntegration();
        } else {
            await disableCodexMcpIntegration();
        }
    }
}
