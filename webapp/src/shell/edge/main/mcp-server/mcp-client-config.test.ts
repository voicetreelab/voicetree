import { promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as mcpClientConfig from './mcp-client-config';

describe('mcp-client-config: OpenCode integration', () => {
    const testDir: string = '/tmp/test-voicetree-mcp-opencode';
    const opencodeConfigPath: string = path.join(testDir, 'opencode.jsonc');

    // Mock the watch folder store
    vi.mock('@/shell/edge/main/state/watch-folder-store', () => ({
        getProjectRootWatchedDirectory: vi.fn(() => testDir)
    }));

    // Mock the MCP server port
    vi.mock('./mcp-server', () => ({
        getMcpPort: vi.fn(() => 3001)
    }));

    beforeEach(async () => {
        // Clean up test directory
        try {
            await fs.mkdir(testDir, { recursive: true });
            await fs.unlink(opencodeConfigPath);
        } catch (_e) {
            // File doesn't exist, which is fine
        }
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.unlink(opencodeConfigPath);
            await fs.rmdir(testDir);
        } catch (_e) {
            // Cleanup failed, ignore
        }
    });

    describe('enableOpencodeMcpIntegration', () => {
        it('should create opencode.jsonc with voicetree config when file does not exist', async () => {
            await expect((mcpClientConfig as any).enableOpencodeMcpIntegration()).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.$schema).toBe('https://opencode.ai/config.json');
            expect(config.mcp).toBeDefined();
            expect(config.mcp.voicetree).toBeDefined();
            expect(config.mcp.voicetree.type).toBe('remote');
            expect(config.mcp.voicetree.url).toBe('http://127.0.0.1:3001/mcp');
            expect(config.mcp.voicetree.enabled).toBe(true);
        });

        it('should preserve existing settings when adding voicetree config', async () => {
            // Create initial config with existing settings
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                model: 'anthropic/claude-sonnet-4-5',
                mcp: {
                    other_server: {
                        type: 'remote',
                        url: 'http://localhost:8080/mcp'
                    }
                }
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).enableOpencodeMcpIntegration()).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.model).toBe('anthropic/claude-sonnet-4-5');
            expect(config.mcp.other_server).toBeDefined();
            expect(config.mcp.voicetree).toBeDefined();
            expect(config.mcp.voicetree.type).toBe('remote');
            expect(config.mcp.voicetree.url).toBe('http://127.0.0.1:3001/mcp');
        });

        it('should update existing voicetree config if it already exists', async () => {
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                mcp: {
                    voicetree: {
                        type: 'remote',
                        url: 'http://localhost:9999/mcp',
                        enabled: false
                    }
                }
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).enableOpencodeMcpIntegration()).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.mcp.voicetree.url).toBe('http://127.0.0.1:3001/mcp');
            expect(config.mcp.voicetree.enabled).toBe(true);
        });
    });

    describe('disableOpencodeMcpIntegration', () => {
        it('should remove voicetree config while preserving other MCP servers', async () => {
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                model: 'anthropic/claude-sonnet-4-5',
                mcp: {
                    voicetree: {
                        type: 'remote',
                        url: 'http://127.0.0.1:3001/mcp',
                        enabled: true
                    },
                    other_server: {
                        type: 'remote',
                        url: 'http://localhost:8080/mcp'
                    }
                }
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).disableOpencodeMcpIntegration()).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.mcp.voicetree).toBeUndefined();
            expect(config.mcp.other_server).toBeDefined();
            expect(config.model).toBe('anthropic/claude-sonnet-4-5');
        });

        it('should delete opencode.jsonc if only voicetree MCP server exists', async () => {
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                mcp: {
                    voicetree: {
                        type: 'remote',
                        url: 'http://127.0.0.1:3001/mcp',
                        enabled: true
                    }
                }
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).disableOpencodeMcpIntegration()).resolves.not.toThrow();

            // File should be deleted
            await expect(fs.readFile(opencodeConfigPath, 'utf-8')).rejects.toThrow();
        });

        it('should preserve schema if only schema remains after removing voicetree', async () => {
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                mcp: {
                    voicetree: {
                        type: 'remote',
                        url: 'http://127.0.0.1:3001/mcp',
                        enabled: true
                    }
                }
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).disableOpencodeMcpIntegration()).resolves.not.toThrow();

            // File should be deleted when only schema remains
            await expect(fs.readFile(opencodeConfigPath, 'utf-8')).rejects.toThrow();
        });

        it('should do nothing if voicetree config does not exist', async () => {
            const initialConfig: any = {
                $schema: 'https://opencode.ai/config.json',
                model: 'anthropic/claude-sonnet-4-5'
            };
            await fs.writeFile(opencodeConfigPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

            await expect((mcpClientConfig as any).disableOpencodeMcpIntegration()).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.model).toBe('anthropic/claude-sonnet-4-5');
        });
    });

    describe('setMcpIntegration with OpenCode agent', () => {
        it('should enable opencode.jsonc when enabled=true for opencode agent', async () => {
            await expect(mcpClientConfig.setMcpIntegration(true, 'opencode --prompt "test"')).resolves.not.toThrow();

            // Check opencode.jsonc was created
            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.mcp?.voicetree).toBeDefined();
            expect(config.mcp.voicetree.url).toBe('http://127.0.0.1:3001/mcp');
        });

        it('should disable opencode.jsonc when enabled=false for opencode agent', async () => {
            // First enable
            await mcpClientConfig.setMcpIntegration(true, 'opencode --prompt "test"');

            // Then disable
            await expect(mcpClientConfig.setMcpIntegration(false, 'opencode --prompt "test"')).resolves.not.toThrow();

            // File should be deleted
            await expect(fs.readFile(opencodeConfigPath, 'utf-8')).rejects.toThrow();
        });

        it('should not write opencode.jsonc for non-opencode agents', async () => {
            await expect(mcpClientConfig.setMcpIntegration(true, 'claude --prompt "test"')).resolves.not.toThrow();

            // opencode.jsonc should not exist
            await expect(fs.readFile(opencodeConfigPath, 'utf-8')).rejects.toThrow();
        });

        it('should write opencode.jsonc for agent command containing "opencode" (case insensitive)', async () => {
            await expect(mcpClientConfig.setMcpIntegration(true, 'OPENCODE --prompt "test"')).resolves.not.toThrow();

            const content: string = await fs.readFile(opencodeConfigPath, 'utf-8');
            const config = JSON.parse(content);

            expect(config.mcp?.voicetree).toBeDefined();
        });
    });
});