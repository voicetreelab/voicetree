import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { getBuildConfig } from './build-config';
import type { BuildConfig } from '@/shell/edge/main/electron/build-config';
import type { Dirent } from 'fs';

/**
 * Get the onboarding directory path in Application Support
 * Returns the user-writable location where onboarding files are stored
 */
export function getOnboardingDirectory(): string {
  return path.join(app.getPath('userData'), 'onboarding');
}

/**
 * Get the onboarding source directory path
 * Returns the bundled source location of onboarding files
 *
 * IMPORTANT: For production builds, onboarding must be in package.json extraResources!
 * Without it, new users get an empty onboarding folder (only chromadb_data appears).
 * See package.json extraResources: {"from": "public/onboarding", "to": "onboarding"}
 */
function getOnboardingSource(): string {
  const appPath: string = app.getAppPath();

  // In production (packaged): use resources path
  // In development: use public folder relative to app path
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'onboarding');
  } else {
    return path.join(appPath, 'public', 'onboarding');
  }
}

/**
 * Recursive async copy function
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries: Dirent<string>[] = await fs.readdir(src, { withFileTypes: true });

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
 * Always copies onboarding tree from source to Application Support
 * This ensures users get updated onboarding files on app updates
 *
 * SKIPS entirely in test mode (HEADLESS_TEST=1) for fast test startup
 *
 * Uses centralized build-config for path resolution
 */
export async function setupOnboardingDirectory(): Promise<void> {
  const config: BuildConfig = getBuildConfig();

  // Skip entirely in test mode
  if (!config.shouldCopyTools) {
    //console.log('[Setup] Skipping onboarding setup in test mode');
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
      await fs.mkdir(onboardingDest, { recursive: true });
      return;
    }

    // Always overwrite with fresh copy from source
    await fs.rm(onboardingDest, { recursive: true, force: true });
    await copyDir(onboardingSource, onboardingDest);
  } catch (error_) {
    console.error('[Setup] Error setting up onboarding directory:', error_);
    throw error_; // Fail fast
  }
}
