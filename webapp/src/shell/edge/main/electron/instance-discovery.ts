/// <reference types="node" />
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getMcpPort } from '@/shell/edge/main/mcp-server/mcp-server';
import { getProjectRootWatchedDirectory, getStartupFolderOverride } from '@/shell/edge/main/state/watch-folder-store';
import { getConfiguredCdpPort } from './environment-config';

function getInstancesDir(): string {
    // Use appData (stable, NOT overridden by dev temp-userData) so instances land at a predictable path.
    // app.getPath('appData') = ~/Library/Application Support on macOS.
    return path.join(app.getPath('appData'), app.getName(), 'instances');
}

function getInstanceFilePath(): string {
    return path.join(getInstancesDir(), `${process.pid}.json`);
}

// Poll DevToolsActivePort until the CDP server writes it (typically <100 ms after app.ready).
async function resolveCdpPort(): Promise<number> {
    const configured = getConfiguredCdpPort();
    if (configured === null) return 0;

    const port = parseInt(configured, 10);
    if (port !== 0) return port;

    // Ephemeral (port 0): read the file Chromium writes after binding.
    const devToolsFile = path.join(app.getPath('userData'), 'DevToolsActivePort');
    for (let i = 0; i < 40; i++) {
        try {
            const content = fs.readFileSync(devToolsFile, 'utf-8');
            const resolved = parseInt(content.split('\n')[0].trim(), 10);
            if (!isNaN(resolved) && resolved > 0) return resolved;
        } catch { /* not written yet */ }
        await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    return 0;
}

export async function registerInstance(): Promise<void> {
    const cdpPort = await resolveCdpPort();
    const vaultPath =
        process.env.VOICETREE_VAULT_PATH ??
        getStartupFolderOverride() ??
        getProjectRootWatchedDirectory() ??
        '';
    const mcpPort = getMcpPort();
    const instance = {
        pid: process.pid,
        vaultPath,
        mcpPort,
        cdpPort,
        startedAt: new Date().toISOString(),
    };
    const dir = getInstancesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getInstanceFilePath(), JSON.stringify(instance, null, 2), 'utf-8');
}

export function unregisterInstance(): void {
    try {
        fs.unlinkSync(getInstanceFilePath());
    } catch { /* already gone */ }
}
