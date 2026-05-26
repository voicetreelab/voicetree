import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { ElectronAPI } from '@/shell/electron';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  electronAPI?: ElectronAPI;
}

export interface FolderManagementFixtures {
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  tempUserDataPath: string;
}
