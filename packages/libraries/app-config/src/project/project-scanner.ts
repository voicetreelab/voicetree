import { rgPath } from '@vscode/ripgrep';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import normalizePath from 'normalize-path';
import type { DiscoveredProject } from '@vt/graph-model/project';

// Transform asar path to unpacked path for production builds
const actualRgPath: string = rgPath.replace('app.asar', 'app.asar.unpacked');

// Directories to skip during deep scanning (inside project folders)
const SKIP_DIRS: readonly string[] = [
    'node_modules',
    'target',
    'build',
    'dist',
    '.cache',
    'Library',
    'AppData',
    '.next',
    '.nuxt',
    '.npm',
    '.yarn',
    '.pnpm-store',
];

// Directories in home folder that trigger OS permission prompts.
// We skip these to avoid showing permission dialogs to users.
// Other inaccessible folders are handled gracefully by ripgrep error handling.
const PROTECTED_HOME_DIRS: readonly string[] = [
    // macOS TCC protected (triggers permission dialog)
    'Desktop',
    'Documents',
    'Downloads',
    'Movies',
    'Music',
    'Pictures',
    // macOS system
    'Library',
    'Applications',
    'Public',
    // Windows TCC-equivalent
    'AppData',
    'Videos',
    '3D Objects',
    'OneDrive',
];

const MAX_DEPTH: number = 4;

type RuntimeProcess = {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
};

function getRuntimeProcess(): RuntimeProcess | undefined {
    return (globalThis as typeof globalThis & {
        process?: RuntimeProcess;
    }).process;
}

/**
 * Returns the Obsidian config file path for the current platform.
 */
function getObsidianConfigPath(): string {
    const home: string = os.homedir();
    const runtimeProcess: RuntimeProcess | undefined = getRuntimeProcess();

    // This module is re-exported from the @vt/graph-model barrel, which the renderer
    // imports for pure graph helpers. Guard bare process access so the barrel stays
    // safe to evaluate in browser contexts where process is not defined.
    switch (runtimeProcess?.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
        case 'win32':
            return path.join(runtimeProcess?.env?.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
        default: // linux
            return path.join(home, '.config', 'obsidian', 'obsidian.json');
    }
}

/**
 * Checks if a path is within any of the given search directories.
 */
function isWithinSearchDirs(targetPath: string, searchDirs: readonly string[]): boolean {
    const normalizedTarget: string = path.normalize(targetPath);
    return searchDirs.some((dir) => {
        const normalizedDir: string = path.normalize(dir);
        return normalizedTarget.startsWith(normalizedDir + path.sep) || normalizedTarget === normalizedDir;
    });
}

/**
 * Obsidian's global config (`obsidian.json` — under `~/Library/Application Support/obsidian/`
 * on macOS, `~/.config/obsidian/` on Linux, `%APPDATA%/obsidian/` on Windows) stores every
 * known vault under a top-level `vaults` map, keyed by an opaque id:
 *
 *     { "vaults": { "<id>": { "path": "/abs/path", "ts": 1700000000000, "open": true } } }
 *
 * Selects the vault paths that exist (per `pathExists`) and fall within `searchDirs`.
 *
 * The config is user-controlled external data we do not own, so this is total by
 * construction — it never throws regardless of the value's shape. A missing or
 * non-object `vaults` key yields no paths; individual malformed entries (missing or
 * non-string `path`) are skipped rather than failing the whole read.
 */
export function selectObsidianVaultPaths(
    config: unknown,
    searchDirs: readonly string[],
    pathExists: (candidate: string) => boolean
): string[] {
    const vaults: unknown = (config as { vaults?: unknown } | null)?.vaults;
    if (vaults === null || typeof vaults !== 'object') {
        return [];
    }

    return Object.values(vaults as Record<string, unknown>)
        .map((entry) => (entry as { path?: unknown } | null)?.path)
        .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
        .filter((candidate) => pathExists(candidate) && isWithinSearchDirs(candidate, searchDirs));
}

/**
 * Reads the Obsidian config file and returns the configured vault paths within the
 * given search directories. Best-effort: an unreadable or malformed config yields an
 * empty list (logged) rather than throwing — shape robustness lives in the total
 * {@link selectObsidianVaultPaths}; this shell only guards file I/O and JSON parsing.
 */
async function getObsidianProjectPaths(searchDirs: readonly string[]): Promise<string[]> {
    const configPath: string = getObsidianConfigPath();

    try {
        if (!fs.existsSync(configPath)) {
            return [];
        }

        const configData: string = await fs.promises.readFile(configPath, 'utf-8');
        return selectObsidianVaultPaths(JSON.parse(configData), searchDirs, fs.existsSync);
    } catch (err) {
        console.error('[project-scanner] Failed to read Obsidian config:', err);
        return [];
    }
}

/**
 * Returns the default search directories for project discovery.
 * Dynamically discovers directories in home folder, filtering out:
 * - Hidden directories (starting with .)
 * - Protected directories that trigger OS permission prompts (Desktop, Documents, etc.)
 * - System directories (Library, AppData, etc.)
 *
 * This approach finds user-created project folders like ~/repos, ~/work, ~/clients
 * without hardcoding and without triggering permission dialogs.
 */
export function getDefaultSearchDirectories(): string[] {
    const home: string = os.homedir();

    try {
        const entries: string[] = fs.readdirSync(home);

        return entries.filter((name) => {
            // Skip hidden directories
            if (name.startsWith('.')) {
                return false;
            }

            // Skip protected/system directories (case-insensitive for Windows)
            const nameLower: string = name.toLowerCase();
            if (PROTECTED_HOME_DIRS.some((dir) => dir.toLowerCase() === nameLower)) {
                return false;
            }

            const fullPath: string = path.join(home, name);

            try {
                // Must be a directory
                if (!fs.statSync(fullPath).isDirectory()) {
                    return false;
                }
                // Verify read access
                fs.readdirSync(fullPath);
                return true;
            } catch {
                return false;
            }
        }).map((name) => path.join(home, name));
    } catch (err) {
        console.error('[project-scanner] Failed to read home directory:', err);
        return [];
    }
}

/**
 * Runs ripgrep to find marker files indicating project types.
 * Uses .git/HEAD for git repos and .obsidian/app.json for Obsidian projects.
 */
async function findMarkerFiles(
    markerGlob: string,
    searchDirs: readonly string[]
): Promise<string[]> {
    // Filter to only existing directories
    const existingDirs: string[] = searchDirs.filter((dir) => {
        try {
            return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
        } catch {
            return false;
        }
    });

    if (existingDirs.length === 0) {
        return [];
    }

    // Build glob exclusions for skip directories
    const excludeGlobs: string[] = SKIP_DIRS.flatMap((dir) => ['-g', `!**/${dir}/**`]);

    return new Promise((resolve, reject) => {
        const args: string[] = [
            '--files',
            '--hidden',
            '--no-ignore-vcs', // Critical: find .git/.obsidian even if they would be ignored
            '-g',
            markerGlob,
            ...excludeGlobs,
            '--max-depth',
            String(MAX_DEPTH + 2), // Add 2 to account for marker file depth (.git/HEAD)
            ...existingDirs,
        ];

        const rg: ChildProcessWithoutNullStreams = spawn(actualRgPath, args, {
            // Use first existing dir as cwd, or home if none exist
            cwd: existingDirs[0] ?? os.homedir(),
        });

        let stdout: string = '';
        let stderr: string = '';

        rg.stdout.on('data', (data: Buffer) => {
            stdout += data;
        });
        rg.stderr.on('data', (data: Buffer) => {
            stderr += data;
        });

        rg.on('close', (code) => {
            // code 0 = matches found
            // code 1 = no matches (not an error)
            // code 2 = error, but may still have partial results (e.g., permission denied on some dirs)
            if (code === 0 || code === 1) {
                resolve(stdout.trim().split('\n').filter(Boolean));
            } else if (code === 2 && stdout.trim().length > 0) {
                // Got some results despite errors (e.g., permission denied on some subdirs) - use them
                resolve(stdout.trim().split('\n').filter(Boolean));
            } else if (code === 2 && stderr.includes('Permission denied')) {
                // All errors were permission denied, no results - that's ok, just no projects there
                resolve([]);
            } else {
                reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
            }
        });

        rg.on('error', reject);
    });
}

/**
 * Extracts project path from a marker file path.
 * e.g., "/path/to/project/.git/HEAD" -> "/path/to/project"
 *
 * Normalizes to forward slashes for cross-platform consistency.
 * Ripgrep on Windows may return backslash paths, so we normalize before slicing.
 */
function extractProjectPath(markerPath: string, markerSuffix: string): string {
    // Normalize to forward slashes (markerSuffix already uses forward slashes)
    const normalized: string = normalizePath(markerPath);
    return normalized.slice(0, -markerSuffix.length);
}

/**
 * Gets the last activity time for a project based on marker file mtime.
 * - Git repos: .git/index (updated on most git operations)
 * - Obsidian projects: .obsidian/workspace.json (updated when project is opened)
 * Falls back to directory mtime if marker file doesn't exist.
 */
async function getProjectActivityTime(projectPath: string, type: 'git' | 'obsidian'): Promise<number> {
    const markerFile: string =
        type === 'git'
            ? path.join(projectPath, '.git', 'index')
            : path.join(projectPath, '.obsidian', 'workspace.json');

    try {
        const stats: fs.Stats = await fs.promises.stat(markerFile);
        return stats.mtimeMs;
    } catch {
        // Fallback to directory mtime
        try {
            const dirStats: fs.Stats = await fs.promises.stat(projectPath);
            return dirStats.mtimeMs;
        } catch {
            return 0;
        }
    }
}

/**
 * Awaits a single best-effort discovery source. On failure it logs and yields an
 * empty result, so one failing source (a crashed ripgrep, an unreadable config)
 * can never reject the surrounding Promise.all or abort the other sources.
 */
async function discoverOrEmpty(label: string, source: Promise<string[]>): Promise<string[]> {
    try {
        return await source;
    } catch (err) {
        console.warn(`[project-scanner] ${label} discovery failed, skipping:`, err);
        return [];
    }
}

/**
 * Scans for git repositories and discovers Obsidian projects.
 * Returns projects sorted by last activity time (most recent first).
 *
 * Uses a hybrid approach:
 * - Obsidian projects: Read from config (instant) + scan for fallback
 * - Git repos: Scan with ripgrep (fast, comprehensive)
 *
 * @param searchDirs - Directories to scan for projects
 * @returns Array of discovered projects sorted by lastActivity descending
 */
export async function scanForProjects(
    searchDirs: readonly string[]
): Promise<DiscoveredProject[]> {
    // Run all discovery methods in parallel. Each source is best-effort and
    // failure-isolated: one source throwing (a crashed ripgrep, an unreadable
    // Obsidian config) yields [] for that source alone and never aborts the
    // others or the scan, so the screen degrades to fewer results, never an error.
    const [gitMarkers, obsidianMarkers, obsidianProjectPaths] = await Promise.all([
        discoverOrEmpty('git', findMarkerFiles('**/.git/HEAD', searchDirs)),
        discoverOrEmpty('obsidian-marker', findMarkerFiles('**/.obsidian/app.json', searchDirs)),
        discoverOrEmpty('obsidian-config', getObsidianProjectPaths(searchDirs)),
    ]);

    // Collect all unique project paths with their types
    const projectEntries: Array<{ path: string; name: string; type: 'git' | 'obsidian' }> = [];
    const seenPaths: Set<string> = new Set<string>();

    // Add Obsidian projects from config first (authoritative source)
    for (const projectPath of obsidianProjectPaths) {
        if (!seenPaths.has(projectPath)) {
            seenPaths.add(projectPath);
            projectEntries.push({
                path: projectPath,
                name: path.basename(projectPath),
                type: 'obsidian',
            });
        }
    }

    // Process scanned Obsidian projects (fallback for projects not in config)
    for (const markerPath of obsidianMarkers) {
        const projectPath: string = extractProjectPath(markerPath, '/.obsidian/app.json');

        if (!seenPaths.has(projectPath)) {
            seenPaths.add(projectPath);
            projectEntries.push({
                path: projectPath,
                name: path.basename(projectPath),
                type: 'obsidian',
            });
        }
    }

    // Process git repositories
    for (const markerPath of gitMarkers) {
        const projectPath: string = extractProjectPath(markerPath, '/.git/HEAD');

        if (!seenPaths.has(projectPath)) {
            seenPaths.add(projectPath);
            projectEntries.push({
                path: projectPath,
                name: path.basename(projectPath),
                type: 'git',
            });
        }
    }

    // Fetch activity times in parallel for all projects
    const projects: DiscoveredProject[] = await Promise.all(
        projectEntries.map(async (entry) => ({
            ...entry,
            lastActivity: await getProjectActivityTime(entry.path, entry.type),
        }))
    );

    // Sort by lastActivity descending (most recent first)
    return projects.sort((a, b) => b.lastActivity - a.lastActivity);
}
