/**
 * E2E TESTS for Project Selection Screen
 *
 * Purpose: Verify the project selection flow works end-to-end in Electron.
 * This tests:
 * 1. First launch shows project selection screen
 * 2. Scanning discovers git/obsidian projects
 * 3. Adding a discovered project saves it and opens graph view
 * 4. Selecting a saved project opens graph view
 * 5. Back button returns to project selection
 * 6. Projects persist across app restarts
 */

import { test } from './electron-project-selection/fixtures';
import './electron-project-selection/project-selection-screen-tests';
import './electron-project-selection/project-scanner-tests';
import './electron-project-selection/watched-folder-panel-tests';

export { test };
