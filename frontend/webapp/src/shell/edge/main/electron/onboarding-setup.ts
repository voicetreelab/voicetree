import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { getBuildConfig } from './build-config';

/**
 * Get the onboarding directory path in Application Support
 * Returns the user-writable location where onboarding files are stored
 */
export function getOnboardingDirectory(): string {
  return path.join(app.getPath('userData'), 'onboarding_tree');
}

/**
 * Get the onboarding source directory path
 * Returns the bundled source location of onboarding files
 *
 * IMPORTANT: For production builds, onboarding_tree must be in package.json extraResources!
 * Without it, new users get an empty onboarding folder (only chromadb_data appears).
 * See package.json extraResources: {"from": "public/onboarding_tree", "to": "onboarding_tree"}
 */
function getOnboardingSource(): string {
  const appPath: string = app.getAppPath();

  // In production (packaged): use resources path
  // In development: use public folder relative to app path
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'onboarding_tree');
  } else {
    return path.join(appPath, 'public', 'onboarding_tree');
  }
}

/**
 * Recursive async copy function
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries: import("fs").Dirent<string>[] = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath: string = path.join(src, entry.name);
    const destPath: string = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Set up onboarding directory
 * Copies onboarding tree from source to Application Support on first run only
 * Preserves user modifications on subsequent runs
 *
 * SKIPS entirely in test mode (HEADLESS_TEST=1) for fast test startup
 *
 * Uses centralized build-config for path resolution
 */
export async function setupOnboardingDirectory(): Promise<void> {
  const config: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/shell/edge/main/electron/build-config").BuildConfig = getBuildConfig();

  // Skip entirely in test mode
  if (!config.shouldCopyTools) {
    console.log('[Setup] Skipping onboarding setup in test mode');
    return;
  }

  // Add timeout wrapper (10 seconds max)
  const timeoutPromise: Promise<void> = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error('[Setup] Timeout: onboarding setup took > 10 seconds'));
    }, 10000);
  });

  const setupPromise: Promise<void> = setupOnboardingDirectoryInternal();

  return Promise.race([setupPromise, timeoutPromise]);
}

async function setupOnboardingDirectoryInternal(): Promise<void> {
  try {
    const onboardingSource: string = getOnboardingSource();
    const onboardingDest: string = getOnboardingDirectory();

    // Check if destination directory already exists
    let destExists: boolean = false;
    try {
      await fs.access(onboardingDest);
      destExists = true;
    } catch {
      // Directory doesn't exist, which is fine
    }

    if (destExists) {
      const entries: string[] = await fs.readdir(onboardingDest);
      if (entries.length > 1) {
        console.log('[Setup] Onboarding directory already exists with user content, preserving modifications');
        return;
      }
      console.log('[Setup] Onboarding directory exists but has <=1 file, refreshing...');
    }

    console.log('[Setup] Setting up onboarding directory...');
    console.log('[Setup] Source path:', onboardingSource);
    console.log('[Setup] Destination path:', onboardingDest);

    // Verify source directory exists
    let onboardingExist: boolean = false;

    try {
      await fs.access(onboardingSource);
      onboardingExist = true;
    } catch {
      console.error('[Setup] Source onboarding directory not found at:', onboardingSource);
    }

    if (!onboardingExist) {
      console.warn('[Setup] Onboarding directory not found. Creating empty directory.');
    }

    // Always create onboarding directory
    await fs.mkdir(onboardingDest, { recursive: true });
    console.log('[Setup] ✓ Created onboarding directory at:', onboardingDest);

    // Copy onboarding directory if source exists
    if (onboardingExist) {
      await copyDir(onboardingSource, onboardingDest);
      console.log('[Setup] ✓ Copied onboarding files to:', onboardingDest);
    }

    console.log('[Setup] Onboarding setup complete!');
  } catch (error_) {
    console.error('[Setup] Error setting up onboarding directory:', error_);
    throw error_; // Fail fast
  }
}
