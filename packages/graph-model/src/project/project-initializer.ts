import path from 'path';
import { generateDateSubfolder, pathExists, copyMarkdownFiles, findExistingVoicetreeDir } from './project-utils';
import { promises as fs } from 'fs';

// Re-export for backward compatibility
export { generateDateSubfolder, pathExists, copyMarkdownFiles, findExistingVoicetreeDir } from './project-utils';

/**
 * Initializes a project with Voicetree scaffolding.
 * Creates a /voicetree-{date} folder and copies onboarding .md files from the source directory.
 *
 * @param projectPath - The root path of the project
 * @param onboardingSourceDir - Optional path to onboarding source files (e.g., ~/Library/Application Support/Voicetree/onboarding/voicetree)
 * @returns The path to the created voicetree subfolder, or null if skipped (already has a voicetree folder)
 */
export async function initializeProject(
    projectPath: string,
    onboardingSourceDir?: string
): Promise<string | null> {
    // Check if any voicetree folder already exists
    const existingVoicetreeDir: string | null = await findExistingVoicetreeDir(projectPath);
    if (existingVoicetreeDir !== null) {
        // Already initialized, return the existing path
        return existingVoicetreeDir;
    }

    // Create new voicetree-{date} directory
    const voicetreeDir: string = path.join(projectPath, generateDateSubfolder());
    await fs.mkdir(voicetreeDir, { recursive: true });

    // Copy onboarding files if source directory is provided and exists
    if (onboardingSourceDir && (await pathExists(onboardingSourceDir))) {
        await copyMarkdownFiles(onboardingSourceDir, voicetreeDir);
    }

    return voicetreeDir;
}
