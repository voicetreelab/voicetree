import { app } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Get the tools directory path in Application Support
 * Returns the user-writable location where agent tools are stored
 */
export function getToolsDirectory(): string {
  return path.join(app.getPath('userData'), 'tools');
}

/**
 * Get the backend directory path in Application Support
 * Returns the user-writable location where backend modules are stored
 */
export function getBackendDirectory(): string {
  return path.join(app.getPath('userData'), 'backend');
}

/**
 * Recursive async copy function
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Set up agent tools and backend directories
 * Copies tools and backend modules from app Resources to Application Support, overwriting existing files
 *
 * SKIPS entirely in test mode (HEADLESS_TEST=1) for fast test startup
 */
export async function setupToolsDirectory(): Promise<void> {
  // Skip entirely in test mode
  if (process.env.HEADLESS_TEST === '1') {
    console.log('[Setup] Skipping tools setup in test mode');
    return;
  }

  // Add timeout wrapper (10 seconds max)
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error('[Setup] Timeout: tools setup took > 10 seconds'));
    }, 10000);
  });

  const setupPromise = setupToolsDirectoryInternal();

  return Promise.race([setupPromise, timeoutPromise]);
}

async function setupToolsDirectoryInternal(): Promise<void> {
  try {
    const toolsDestPath = getToolsDirectory();
    const backendDestPath = getBackendDirectory();

    // Remove existing directories if they exist to ensure fresh copy
    try {
      await fs.rm(toolsDestPath, { recursive: true, force: true });
      console.log('[Setup] Removed existing tools directory');
    } catch {
      // Directory doesn't exist, which is fine
    }

    try {
      await fs.rm(backendDestPath, { recursive: true, force: true });
      console.log('[Setup] Removed existing backend directory');
    } catch {
      // Directory doesn't exist, which is fine
    }

    console.log('[Setup] Setting up tools and backend directories...');

    // Determine source paths based on whether app is packaged
    let toolsSourcePath: string;
    let backendSourcePath: string;

    if (app.isPackaged) {
      // Packaged app: Use process.resourcesPath
      toolsSourcePath = path.join(process.resourcesPath, 'tools');
      backendSourcePath = path.join(process.resourcesPath, 'backend');
      console.log('[Setup] Packaged app - copying from:', process.resourcesPath);
    } else {
      // Development: Use project root
      const appPath = app.getAppPath();
      const projectRoot = path.resolve(appPath, '../..');
      const resourcesPath = path.join(projectRoot, 'dist', 'resources');
      toolsSourcePath = path.join(resourcesPath, 'tools');
      backendSourcePath = path.join(resourcesPath, 'backend');
      console.log('[Setup] Development - copying from:', resourcesPath);
    }

    // Verify source directories exist
    let toolsExist = false;
    let backendExist = false;

    try {
      await fs.access(toolsSourcePath);
      toolsExist = true;
    } catch (error) {
      console.error('[Setup] Source tools directory not found at:', toolsSourcePath);
    }

    try {
      await fs.access(backendSourcePath);
      backendExist = true;
    } catch (error) {
      console.error('[Setup] Source backend directory not found at:', backendSourcePath);
    }

    if (!toolsExist && !backendExist) {
      console.error('[Setup] Neither tools nor backend directories found. Run build_and_package_all.sh to bundle resources.');
      return;
    }

    // Create parent directory if needed
    await fs.mkdir(path.dirname(toolsDestPath), { recursive: true });

    // Copy tools directory if it exists (async)
    if (toolsExist) {
      await copyDir(toolsSourcePath, toolsDestPath);
      console.log('[Setup] ✓ Successfully copied tools to:', toolsDestPath);
    }

    // Copy backend directory if it exists (async)
    if (backendExist) {
      await copyDir(backendSourcePath, backendDestPath);
      console.log('[Setup] ✓ Successfully copied backend to:', backendDestPath);
    }

    console.log('[Setup] Setup complete!');
  } catch (error) {
    console.error('[Setup] Error setting up directories:', error);
    throw error; // Fail fast
  }
}
