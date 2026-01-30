import { rgPath } from '@vscode/ripgrep';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import normalizePath from 'normalize-path';
import type { DiscoveredProject } from '@/pure/project/types';

// Transform asar path to unpacked path for production builds
const actualRgPath: string = rgPath.replace('app.asar', 'app.asar.unpacked');

// Directories to skip during scanning
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

const MAX_DEPTH: number = 4;

/**
 * Returns the Obsidian config file path for the current platform.
 */
function getObsidianConfigPath(): string {
    const home: string = os.homedir();
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
        case 'win32':
            return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
        default: // linux
            return path.join(home, '.config', 'obsidian', 'obsidian.json');
    }
}

interface ObsidianVault {
    path: string;
    ts: number;
    open?: boolean;
}

interface ObsidianConfig {
    vaults: Record<string, ObsidianVault>;
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
 * Reads Obsidian vault paths directly from Obsidian's config file.
 * Only returns vaults within the specified search directories.
 */
async function getObsidianVaultPaths(searchDirs: readonly string[]): Promise<string[]> {
    const configPath: string = getObsidianConfigPath();

    try {
        if (!fs.existsSync(configPath)) {
            return [];
        }

        const configData: string = await fs.promises.readFile(configPath, 'utf-8');
        const config: ObsidianConfig = JSON.parse(configData) as ObsidianConfig;

        const vaultPaths: string[] = [];

        for (const vault of Object.values(config.vaults)) {
            // Skip if path doesn't exist anymore
            if (!fs.existsSync(vault.path)) {
                continue;
            }

            // Only include vaults within search directories
            if (!isWithinSearchDirs(vault.path, searchDirs)) {
                continue;
            }

            vaultPaths.push(vault.path);
        }

        return vaultPaths;
    } catch (err) {
        console.error('[project-scanner] Failed to read Obsidian config:', err);
        return [];
    }
}

/**
 * Returns the default search directories for project discovery.
 * Uses os.homedir() for cross-platform support.
 * Filters to only directories that exist AND are readable (have permission).
 */
export function getDefaultSearchDirectories(): string[] {
    const home: string = os.homedir();

    const candidates: string[] = [
        path.join(home, 'repos'),
        path.join(home, 'dev'),
        path.join(home, 'work'),
        path.join(home, 'code'),
        path.join(home, 'projects'),
        path.join(home, 'Documents'),
    ];

    // Filter to only existing directories that we have read access to
    return candidates.filter((dir) => {
        try {
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                return false;
            }
            // Verify read access by attempting to read directory contents
            fs.readdirSync(dir);
            return true;
        } catch {
            return false;
        }
    });
}

/**
 * Runs ripgrep to find marker files indicating project types.
 * Uses .git/HEAD for git repos and .obsidian/app.json for Obsidian vaults.
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
            if (code === 0 || code === 1) {
                // code 1 = no matches (not an error)
                resolve(stdout.trim().split('\n').filter(Boolean));
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
 * - Obsidian vaults: .obsidian/workspace.json (updated when vault is opened)
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
 * Scans for git repositories and discovers Obsidian vaults.
 * Returns projects sorted by last activity time (most recent first).
 *
 * Uses a hybrid approach:
 * - Obsidian vaults: Read from config (instant) + scan for fallback
 * - Git repos: Scan with ripgrep (fast, comprehensive)
 *
 * @param searchDirs - Directories to scan for projects
 * @returns Array of discovered projects sorted by lastActivity descending
 */
export async function scanForProjects(
    searchDirs: readonly string[]
): Promise<DiscoveredProject[]> {
    // Run all discovery methods in parallel
    const [gitMarkers, obsidianMarkers, obsidianVaultPaths] = await Promise.all([
        findMarkerFiles('**/.git/HEAD', searchDirs),
        findMarkerFiles('**/.obsidian/app.json', searchDirs),
        getObsidianVaultPaths(searchDirs),
    ]);

    // Collect all unique project paths with their types
    const projectEntries: Array<{ path: string; name: string; type: 'git' | 'obsidian' }> = [];
    const seenPaths: Set<string> = new Set<string>();

    // Add Obsidian vaults from config first (authoritative source)
    for (const vaultPath of obsidianVaultPaths) {
        if (!seenPaths.has(vaultPath)) {
            seenPaths.add(vaultPath);
            projectEntries.push({
                path: vaultPath,
                name: path.basename(vaultPath),
                type: 'obsidian',
            });
        }
    }

    // Process scanned Obsidian vaults (fallback for vaults not in config)
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
