import { promises as fs } from 'fs';
import path from 'path';
import type { Dirent } from 'fs';

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
 * Copies all .md files from source directory to destination directory.
 * Only copies files, not subdirectories.
 */
async function copyMarkdownFiles(sourceDir: string, destDir: string): Promise<number> {
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

/**
 * Initializes a project with VoiceTree scaffolding.
 * Creates a /voicetree folder and copies onboarding .md files from the source directory.
 *
 * @param projectPath - The root path of the project
 * @param onboardingSourceDir - Optional path to onboarding source files (e.g., ~/Library/Application Support/VoiceTree/onboarding/voicetree)
 * @returns true if initialization was performed, false if skipped
 */
export async function initializeProject(
    projectPath: string,
    onboardingSourceDir?: string
): Promise<boolean> {
    const voicetreeDir: string = path.join(projectPath, 'voicetree');

    // Skip if voicetree folder already exists
    if (await pathExists(voicetreeDir)) {
        return false;
    }

    // Create the voicetree directory
    await fs.mkdir(voicetreeDir, { recursive: true });

    // Copy onboarding files if source directory is provided and exists
    if (onboardingSourceDir && (await pathExists(onboardingSourceDir))) {
        await copyMarkdownFiles(onboardingSourceDir, voicetreeDir);
    }

    return true;
}
