/// <reference types="node" />
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getConfiguredCdpPort } from './environment-config';
import { getStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override';

function getInstancesDir(): string {
    // Use appData (stable, NOT overridden by dev temp-userData) so instances land at a predictable path.
    // app.getPath('appData') = ~/Library/Application Support on macOS.
    return path.join(app.getPath('appData'), app.getName(), 'instances');
}

function getInstanceFilePath(): string {
    return path.join(getInstancesDir(), `${process.pid}.json`);
}

const DEVTOOLS_ACTIVE_PORT_POLL_ATTEMPTS: number = 200;
const DEVTOOLS_ACTIVE_PORT_POLL_INTERVAL_MS: number = 50;

function getDevToolsActivePortPath(): string {
    return path.join(app.getPath('userData'), 'DevToolsActivePort');
}

function parseDevToolsActivePort(content: string): number | null {
    const resolved: number = parseInt(content.split('\n')[0].trim(), 10);
    return !isNaN(resolved) && resolved > 0 ? resolved : null;
}

function describeDirectoryEntries(dir: string): string {
    try {
        const entries: string[] = fs.readdirSync(dir);
        return entries.length > 0 ? entries.join(', ') : '<empty>';
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error);
        return `<unreadable: ${message}>`;
    }
}

async function delay(ms: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
}

// Poll DevToolsActivePort until the CDP server writes it. Slow machines and
// fresh Electron profiles can take longer than the usual sub-second path.
async function resolveCdpPort(): Promise<number> {
    const configured: string | null = getConfiguredCdpPort();
    if (configured === null) return 0;

    const port: number = parseInt(configured, 10);
    if (port !== 0) return port;

    // Ephemeral (port 0): read the file Chromium writes after binding.
    const devToolsFile: string = getDevToolsActivePortPath();
    let loggedFirstMiss: boolean = false;
    for (let i: number = 0; i < DEVTOOLS_ACTIVE_PORT_POLL_ATTEMPTS; i++) {
        try {
            const content: string = fs.readFileSync(devToolsFile, 'utf-8');
            const resolved: number | null = parseDevToolsActivePort(content);
            if (resolved !== null) return resolved;
        } catch {
            if (!loggedFirstMiss) {
                const dir: string = path.dirname(devToolsFile);
                console.warn(
                    `vt-debug: waiting for DevToolsActivePort at ${devToolsFile}; ${dir} contains: ${describeDirectoryEntries(dir)}`,
                );
                loggedFirstMiss = true;
            }
        }
        await delay(DEVTOOLS_ACTIVE_PORT_POLL_INTERVAL_MS);
    }
    return 0;
}

function assertDebugCdpPortResolved(cdpPort: number): void {
    if (process.env.ENABLE_PLAYWRIGHT_DEBUG === '1' && cdpPort === 0) {
        throw new Error(
            `vt-debug: ENABLE_PLAYWRIGHT_DEBUG=1 but resolveCdpPort() returned 0; check DevToolsActivePort polling at ${getDevToolsActivePortPath()}`,
        );
    }
}

interface InstanceRecord {
    readonly pid: number;
    readonly projectRoot: string;
    readonly cdpPort: number;
    readonly startedAt: string;
}

export async function registerInstance(): Promise<void> {
    const cdpPort: number = await resolveCdpPort();
    assertDebugCdpPortResolved(cdpPort);
    const projectRoot: string =
        process.env.VOICETREE_VAULT_PATH ??
        getStartupFolderOverride() ??
        '';
    const instance: InstanceRecord = {
        pid: process.pid,
        projectRoot,
        cdpPort,
        startedAt: new Date().toISOString(),
    };
    const dir: string = getInstancesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getInstanceFilePath(), JSON.stringify(instance, null, 2), 'utf-8');
}

export function unregisterInstance(): void {
    try {
        fs.unlinkSync(getInstanceFilePath());
    } catch { /* already gone */ }
}
