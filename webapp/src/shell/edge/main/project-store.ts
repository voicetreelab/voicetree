import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { SavedProject } from '@/pure/project/types';

function getProjectsFilePath(): string {
    return path.join(app.getPath('userData'), 'projects.json');
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
async function readProjectsFile(): Promise<SavedProject[]> {
    const filePath: string = getProjectsFilePath();

    try {
        const data: string = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as SavedProject[];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

/**
 * Writes the projects array to disk.
 */
async function writeProjectsFile(projects: SavedProject[]): Promise<void> {
    const filePath: string = getProjectsFilePath();
    const dir: string = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(projects, null, 2), 'utf-8');
}

/**
 * Loads saved projects from disk.
 * Filters out projects whose paths no longer exist.
 */
export async function loadProjects(): Promise<SavedProject[]> {
    const projects: SavedProject[] = await readProjectsFile();

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
    const projects: SavedProject[] = await readProjectsFile();

    const existingIndex: number = projects.findIndex((p) => p.id === project.id);

    if (existingIndex >= 0) {
        projects[existingIndex] = project;
    } else {
        projects.push(project);
    }

    await writeProjectsFile(projects);
}

/**
 * Removes a project from the store by ID.
 */
export async function removeProject(id: string): Promise<void> {
    const projects: SavedProject[] = await readProjectsFile();
    const filtered: SavedProject[] = projects.filter((p) => p.id !== id);
    await writeProjectsFile(filtered);
}
