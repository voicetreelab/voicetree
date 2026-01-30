/**
 * Shared utilities for project initialization.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Dirent } from 'fs';

/**
 * Generate date-based subfolder name: voicetree-{day}-{month}
 */
export function generateDateSubfolder(): string {
    const now: Date = new Date();
    return `voicetree-${now.getDate()}-${now.getMonth() + 1}`;
}

// Pattern to match voicetree-{day}-{month} format
const VOICETREE_DATE_PATTERN: RegExp = /^voicetree-\d{1,2}-\d{1,2}$/;

/**
 * Find an existing voicetree directory in the project.
 * Looks for directories matching 'voicetree' (exact) or 'voicetree-{day}-{month}' pattern.
 */
export async function findExistingVoicetreeDir(projectPath: string): Promise<string | null> {
    try {
        const entries: Dirent<string>[] = await fs.readdir(projectPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && (entry.name === 'voicetree' || VOICETREE_DATE_PATTERN.test(entry.name))) {
                return path.join(projectPath, entry.name);
            }
        }
    } catch {
        // Directory might not exist or not readable
    }
    return null;
}

/**
 * Checks if a path exists on the filesystem.
 */
export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Copies all .md files from source directory to destination directory.
 * Only copies files, not subdirectories.
 */
export async function copyMarkdownFiles(sourceDir: string, destDir: string): Promise<number> {
    const entries: Dirent<string>[] = await fs.readdir(sourceDir, { withFileTypes: true });
    const mdFiles: Dirent<string>[] = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md')
    );

    await Promise.all(
        mdFiles.map(async (file) => {
            const srcPath: string = path.join(sourceDir, file.name);
            const destPath: string = path.join(destDir, file.name);
            await fs.copyFile(srcPath, destPath);
        })
    );

    return mdFiles.length;
}
