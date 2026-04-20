import fs from 'fs';
import path from 'path';
import os from 'os';

export type DebugInstance = {
    pid: number;
    vaultPath: string;
    mcpPort: number;
    cdpPort: number;
    startedAt: string;
};

export type PickOpts = {
    port?: number;   // match cdpPort or mcpPort
    pid?: number;
    vault?: string;  // match resolved vaultPath prefix
};

export type PickResult =
    | { ok: true; instance: DebugInstance }
    | { ok: false; message: string; hint?: string; instances?: DebugInstance[] };

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

export function filterInstancesBySelector(
    liveFiles: DebugInstance[],
    opts: PickOpts = {},
): DebugInstance[] {
    if (opts.port !== undefined) {
        return liveFiles.filter(
            i => i.cdpPort === opts.port || i.mcpPort === opts.port,
        );
    }

    if (opts.pid !== undefined) {
        return liveFiles.filter(i => i.pid === opts.pid);
    }

    if (opts.vault !== undefined) {
        const resolved = path.resolve(opts.vault);
        return liveFiles.filter(i => path.resolve(i.vaultPath).startsWith(resolved));
    }

    return liveFiles;
}

/** Select one DebugInstance from a list of live files, applying opt filters.
 *
 * Filter precedence: --port > --pid > --vault > single-live > ambiguous error.
 */
export function pickInstance(liveFiles: DebugInstance[], opts: PickOpts = {}): PickResult {
    const candidates = filterInstancesBySelector(liveFiles, opts);

    if (candidates.length === 1) {
        return { ok: true, instance: candidates[0] };
    }

    if (candidates.length === 0) {
        return {
            ok: false,
            message: 'no running voicetree instance found',
            hint: 'start voicetree in development mode or pass --port / --pid / --vault to narrow',
        };
    }

    // >1 candidate — ambiguous
    const list = candidates
        .map(i => `  pid=${i.pid}  vault=${i.vaultPath}  cdp=${i.cdpPort}  mcp=${i.mcpPort}`)
        .join('\n');
    return {
        ok: false,
        message: `${candidates.length} instances running — use --port, --pid, or --vault to select one:\n${list}`,
        hint: 'vt-debug ls  to list all instances',
        instances: candidates,
    };
}

// ---------------------------------------------------------------------------
// Shell helpers (effectful — filesystem + process signals)
// ---------------------------------------------------------------------------

function defaultInstancesDir(): string {
    // Mirrors the Electron-side path: app.getPath('appData') + app.getName() + 'instances'.
    // appData = ~/Library/Application Support on macOS, ~/.config on Linux.
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Voicetree', 'instances');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(xdg, 'Voicetree', 'instances');
}

/** Read all instance JSON files from the instances directory.
 *  Returns an empty array if the directory does not exist or any file is malformed.
 */
export async function readInstancesDir(dir?: string): Promise<DebugInstance[]> {
    const instancesDir = dir ?? (
        process.env.VOICETREE_APP_SUPPORT
            ? path.join(process.env.VOICETREE_APP_SUPPORT, 'instances')
            : defaultInstancesDir()
    );

    let entries: string[];
    try {
        entries = fs.readdirSync(instancesDir).filter(f => f.endsWith('.json'));
    } catch {
        return [];
    }

    const instances: DebugInstance[] = [];
    for (const entry of entries) {
        try {
            const raw = fs.readFileSync(path.join(instancesDir, entry), 'utf-8');
            const parsed = JSON.parse(raw) as DebugInstance;
            if (
                typeof parsed.pid === 'number' &&
                typeof parsed.cdpPort === 'number' &&
                typeof parsed.mcpPort === 'number'
            ) {
                instances.push(parsed);
            }
        } catch { /* skip malformed files */ }
    }
    return instances;
}

/** Remove instances whose process is no longer alive.
 *  Uses process.kill(pid, 0) as a lightweight liveness probe (signal 0 = probe only).
 */
export async function filterLive(instances: DebugInstance[]): Promise<DebugInstance[]> {
    return instances.filter(inst => {
        try {
            process.kill(inst.pid, 0);
            return true;
        } catch {
            return false;
        }
    });
}

export async function listLiveInstances(dir?: string): Promise<DebugInstance[]> {
    return filterLive(await readInstancesDir(dir));
}
