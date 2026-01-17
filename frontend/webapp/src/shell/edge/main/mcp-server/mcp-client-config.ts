/**
 * MCP Client Configuration
 *
 * Manages the .mcp.json file in the watched directory to configure
 * MCP clients (like Claude Code) to connect to VoiceTree's MCP server.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getWatchedDirectory } from '@/shell/edge/main/graph/watch_folder/watchFolder';
import { getMcpPort } from './mcp-server';

const VOICETREE_MCP_SERVER_NAME: 'voicetree' = 'voicetree' as const;

interface McpServerConfig {
    type: string;
    url: string;
}

interface McpJsonConfig {
    mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Get the path to .mcp.json in the watched directory
 */
function getMcpJsonPath(): string | null {
    const watchedDir: string | null = getWatchedDirectory();
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
 * Check if VoiceTree MCP integration is enabled in .mcp.json
 */
export async function isMcpIntegrationEnabled(): Promise<boolean> {
    const config: McpJsonConfig = await readMcpJson();
    return config.mcpServers?.[VOICETREE_MCP_SERVER_NAME] !== undefined;
}

/**
 * Enable VoiceTree MCP integration by adding config to .mcp.json
 * Merges with existing config to preserve other MCP servers
 */
export async function enableMcpIntegration(): Promise<void> {
    const config: McpJsonConfig = await readMcpJson();
    const port: number = getMcpPort();

    // Merge VoiceTree server into existing config
    config.mcpServers = {
        ...config.mcpServers,
        [VOICETREE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `http://localhost:${port}/mcp`
        }
    };

    await writeMcpJson(config);
    console.log('[MCP] Enabled VoiceTree MCP integration in .mcp.json');
}

/**
 * Disable VoiceTree MCP integration by removing config from .mcp.json
 * Preserves other MCP servers in the config
 */
export async function disableMcpIntegration(): Promise<void> {
    const config: McpJsonConfig = await readMcpJson();

    if (config.mcpServers?.[VOICETREE_MCP_SERVER_NAME]) {
        delete config.mcpServers[VOICETREE_MCP_SERVER_NAME];

        // Clean up empty mcpServers object
        if (Object.keys(config.mcpServers).length === 0) {
            delete config.mcpServers;
        }

        await writeMcpJson(config);
        console.log('[MCP] Disabled VoiceTree MCP integration in .mcp.json');
    }
}

/**
 * Set MCP integration state - enables or disables based on boolean
 */
export async function setMcpIntegration(enabled: boolean): Promise<void> {
    if (enabled) {
        await enableMcpIntegration();
    } else {
        await disableMcpIntegration();
    }
}
