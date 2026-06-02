import type { ElectronApplication, Page } from '@playwright/test';
import type { Core as CytoscapeCore } from 'cytoscape';
import type { HostAPI } from '@/shell/hostApi';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}

export type UnifiedFolderLoadingFixtures = {
  electronApp: ElectronApplication;
  appWindow: Page;
  testProjectPath: string;
  primaryProjectPath: string;
  secondProjectPath: string;
  tempUserDataPath: string;
};
