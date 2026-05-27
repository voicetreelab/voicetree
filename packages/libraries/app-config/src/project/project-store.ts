import { promises as fs } from 'fs';
import path from 'path';
import type { SavedProject } from '@vt/graph-model/project';

function getProjectsFilePath(appSupportPath: string): string {
    return path.join(appSupportPath, 'projects.json');
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
async function readProjectsFile(appSupportPath: string): Promise<SavedProject[]> {
    const filePath: string = getProjectsFilePath(appSupportPath);

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
async function writeProjectsFile(appSupportPath: string, projects: SavedProject[]): Promise<void> {
    const filePath: string = getProjectsFilePath(appSupportPath);
    const dir: string = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(projects, null, 2), 'utf-8');
}

/**
 * Loads saved projects from disk.
 * Filters out projects whose paths no longer exist.
 */
export async function loadProjects(appSupportPath: string): Promise<SavedProject[]> {
    const projects: SavedProject[] = await readProjectsFile(appSupportPath);

    // Filter out projects with missing paths
    const existenceChecks: Promise<boolean>[] = projects.map((p) => pathExists(p.path));
    const exists: boolean[] = await Promise.all(existenceChecks);

    return projects.filter((_, index) => exists[index]);
}

/**
 * Saves or updates a project in the store.
 * If a project with the same ID exists, it will be updated.
 */
export async function saveProject(appSupportPath: string, project: SavedProject): Promise<void> {
    const projects: SavedProject[] = await readProjectsFile(appSupportPath);

    const existingIndex: number = projects.findIndex((p) => p.id === project.id);

    if (existingIndex >= 0) {
        projects[existingIndex] = project;
    } else {
        projects.push(project);
    }

    await writeProjectsFile(appSupportPath, projects);
}

/**
 * Removes a project from the store by ID.
 */
export async function removeProject(appSupportPath: string, id: string): Promise<void> {
    const projects: SavedProject[] = await readProjectsFile(appSupportPath);
    const filtered: SavedProject[] = projects.filter((p) => p.id !== id);
    await writeProjectsFile(appSupportPath, filtered);
}
