import { promises as fs } from 'fs';
import path from 'path';
import type { SavedProject } from '@vt/graph-model/project';
import {normalizeProjectPath, resolveVoicetreeHomePath} from '@vt/paths';
import {PROJECTS_FILENAME} from '../config-files.ts';

/**
 * Collapse projects that point at the same on-disk directory.
 *
 * Two entries can differ only by path casing (e.g. `~/Voicetree` vs
 * `~/voicetree` on a case-insensitive filesystem) or by symlink, yet refer to
 * one directory. Grouping by canonical path keeps a single entry per real
 * directory — the most-recently-opened one — so the recent-projects list never
 * shows a directory twice and re-opening with a different casing never forks a
 * second record.
 *
 * `canonicalize` is injected so this stays a pure, platform-independent
 * transform that is black-box testable without touching disk; production passes
 * {@link normalizeProjectPath}.
 */
export function dedupeProjectsByCanonicalPath(
    projects: readonly SavedProject[],
    canonicalize: (projectPath: string) => string,
): SavedProject[] {
    const byCanonicalPath: Map<string, SavedProject> = new Map();
    for (const project of projects) {
        const key: string = canonicalize(project.path);
        const existing: SavedProject | undefined = byCanonicalPath.get(key);
        if (!existing || project.lastOpened >= existing.lastOpened) {
            byCanonicalPath.set(key, project);
        }
    }
    return [...byCanonicalPath.values()];
}

function getProjectsFilePath(voicetreeHomePath: string): string {
    return path.join(voicetreeHomePath, PROJECTS_FILENAME);
}

/**
 * Checks if a path exists on the filesystem.
 */
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads the raw projects array from disk.
 * Returns empty array if file doesn't exist.
 */
async function readProjectsFile(voicetreeHomePath: string): Promise<SavedProject[]> {
    const filePath: string = getProjectsFilePath(voicetreeHomePath);

    try {
        const data: string = await fs.readFile(filePath, 'utf-8');
        if (!data.trim()) return [];
        return JSON.parse(data) as SavedProject[];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        if (error instanceof SyntaxError) {
            console.warn(`[project-store] Corrupt projects.json, resetting: ${error.message}`);
            return [];
        }
        throw error;
    }
}

/**
 * Writes the projects array to disk.
 */
async function writeProjectsFile(voicetreeHomePath: string, projects: SavedProject[]): Promise<void> {
    const filePath: string = getProjectsFilePath(voicetreeHomePath);
    const dir: string = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(projects, null, 2), 'utf-8');
}

/**
 * Loads saved projects from disk.
 * Filters out projects whose paths no longer exist.
 */
export async function loadProjects(): Promise<SavedProject[]> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    const projects: SavedProject[] = await readProjectsFile(voicetreeHomePath);

    // Filter out projects with missing paths
    const existenceChecks: Promise<boolean>[] = projects.map((p) => pathExists(p.path));
    const exists: boolean[] = await Promise.all(existenceChecks);
    const present: SavedProject[] = projects.filter((_, index) => exists[index]);

    // Collapse casing/symlink variants so legacy records written before path
    // normalization still surface as one entry per real directory.
    return dedupeProjectsByCanonicalPath(present, normalizeProjectPath);
}

/**
 * Saves or updates a project in the store.
 * If a project with the same ID exists, it will be updated.
 */
export async function saveProject(project: SavedProject): Promise<void> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    const projects: SavedProject[] = await readProjectsFile(voicetreeHomePath);
    const canonicalPath: string = normalizeProjectPath(project.path);

    // Drop the prior record of this project — matched by id (an update) or by
    // canonical path (a casing/symlink variant of the same directory) — so the
    // freshly-opened project becomes the single entry for that directory.
    const others: SavedProject[] = projects.filter(
        (p) => p.id !== project.id && normalizeProjectPath(p.path) !== canonicalPath,
    );
    others.push(project);

    await writeProjectsFile(voicetreeHomePath, others);
}

/**
 * Removes a project from the store by ID.
 */
export async function removeProject(id: string): Promise<void> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    const projects: SavedProject[] = await readProjectsFile(voicetreeHomePath);
    const filtered: SavedProject[] = projects.filter((p) => p.id !== id);
    await writeProjectsFile(voicetreeHomePath, filtered);
}
