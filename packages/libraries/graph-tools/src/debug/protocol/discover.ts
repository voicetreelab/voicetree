import fs from 'fs';
import path from 'path';
import os from 'os';

export type DebugInstance = {
    pid: number;
    projectRoot: string;
    cdpPort: number;
    startedAt: string;
};

export type PickOpts = {
    port?: number;   // match cdpPort (legacy CLI flag historically accepted the daemon tool-server port too — that port is gone in 7f)
    pid?: number;
    project?: string;  // match resolved projectRoot prefix
    forceNew?: boolean;  // --new: skip existing instances, always launch fresh
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
        return liveFiles.filter(i => i.cdpPort === opts.port);
    }

    if (opts.pid !== undefined) {
        return liveFiles.filter(i => i.pid === opts.pid);
    }

    if (opts.project !== undefined) {
        const resolved = path.resolve(opts.project);
        return liveFiles.filter(i => path.resolve(i.projectRoot).startsWith(resolved));
    }

    return liveFiles;
}

/** Select one DebugInstance from a list of live files, applying opt filters.
 *
 * Filter precedence: --port > --pid > --project > single-live > ambiguous error.
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
            hint: 'start voicetree in development mode or pass --port / --pid / --project to narrow',
        };
    }

    // >1 candidate — ambiguous
    const list = candidates
        .map(i => `  pid=${i.pid}  project=${i.projectRoot}  cdp=${i.cdpPort}`)
        .join('\n');
    return {
        ok: false,
        message: `${candidates.length} instances running — use --port, --pid, or --project to select one:\n${list}`,
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
        return path.join(os.homedir(), 'Library', 'Application Support', 'VoiceTree', 'instances');
    }
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    return path.join(xdg, 'VoiceTree', 'instances');
}

/** Read all instance JSON files from the instances directory.
 *  Returns an empty array if the directory does not exist or any file is malformed.
 */
export async function readInstancesDir(dir?: string): Promise<DebugInstance[]> {
    const instancesDir = dir ?? defaultInstancesDir();

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
                typeof parsed.cdpPort === 'number'
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
