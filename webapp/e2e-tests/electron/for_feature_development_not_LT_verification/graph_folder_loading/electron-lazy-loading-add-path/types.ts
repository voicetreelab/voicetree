import type { Core as CytoscapeCore } from 'cytoscape';
import type { HostAPI } from '@/shell/hostApi';

export interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore;
  hostAPI?: HostAPI;
}
