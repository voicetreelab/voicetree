import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export type UnifiedFolderLoadingFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  primaryProjectPath: string;
  secondProjectPath: string;
  tempUserDataPath: string;
};
