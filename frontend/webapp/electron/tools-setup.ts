import { app } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

/**
 * Get the tools directory path in Application Support
 * Returns the user-writable location where agent tools are stored
 */
export function getToolsDirectory(): string {
  return path.join(app.getPath('userData'), 'tools');
}

/**
 * Set up agent tools directory
 * Copies tools from app Resources to Application Support, overwriting existing tools
 */
export async function setupToolsDirectory(): Promise<void> {
  try {
    const toolsDestPath = getToolsDirectory();

    // Remove existing tools directory if it exists to ensure fresh copy
    try {
      await fs.rm(toolsDestPath, { recursive: true, force: true });
      console.log('[Tools] Removed existing tools directory');
    } catch {
      // Directory doesn't exist, which is fine
    }

    console.log('[Tools] Setting up tools directory...');

    // Determine source path based on whether app is packaged
    let toolsSourcePath: string;
    if (app.isPackaged) {
      // Packaged app: Use process.resourcesPath
      toolsSourcePath = path.join(process.resourcesPath, 'tools');
      console.log('[Tools] Packaged app - copying from:', toolsSourcePath);
    } else {
      // Development: Use project root
      const appPath = app.getAppPath();
      const projectRoot = path.resolve(appPath, '../..');
      toolsSourcePath = path.join(projectRoot, 'dist', 'resources', 'tools');
      console.log('[Tools] Development - copying from:', toolsSourcePath);
    }

    // Verify source exists
    try {
      await fs.access(toolsSourcePath);
    } catch (error) {
      console.error('[Tools] Source tools directory not found at:', toolsSourcePath);
      console.error('[Tools] Tools will not be available. Run build_and_package_all.sh to bundle tools.');
      return;
    }

    // Create parent directory if needed
    await fs.mkdir(path.dirname(toolsDestPath), { recursive: true });

    // Copy tools directory using cp -r (Unix) or xcopy (Windows)
    if (process.platform === 'win32') {
      execSync(`xcopy /E /I /Y "${toolsSourcePath}" "${toolsDestPath}"`);
    } else {
      execSync(`cp -r "${toolsSourcePath}" "${toolsDestPath}"`);
    }

    console.log('[Tools] Successfully copied tools to:', toolsDestPath);
  } catch (error) {
    console.error('[Tools] Error setting up tools directory:', error);
  }
}
