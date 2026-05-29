import { promises as fs } from 'fs';
import path from 'path';
import type { SavedProject } from '@vt/graph-model/project';
import {resolveVoicetreeHomePath} from '@vt/paths';

function getProjectsFilePath(voicetreeHomePath: string): string {
    return path.join(voicetreeHomePath, 'projects.json');
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

    return projects.filter((_, index) => exists[index]);
}

/**
 * Saves or updates a project in the store.
 * If a project with the same ID exists, it will be updated.
 */
export async function saveProject(project: SavedProject): Promise<void> {
    const voicetreeHomePath: string = resolveVoicetreeHomePath();
    const projects: SavedProject[] = await readProjectsFile(voicetreeHomePath);

    const existingIndex: number = projects.findIndex((p) => p.id === project.id);

    if (existingIndex >= 0) {
        projects[existingIndex] = project;
    } else {
        projects.push(project);
    }

    await writeProjectsFile(voicetreeHomePath, projects);
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
