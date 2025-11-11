// Type declarations for cytoscape-cxtmenu plugin
import type { Singular } from 'cytoscape';

export interface CxtMenuCommand {
  content: string | HTMLElement;
  select: (ele?: Singular) => void | Promise<void>;
  enabled: boolean;
}

export interface CxtMenuOptions {
  menuRadius?: number;
  selector?: string;
  commands: (ele?: Singular) => CxtMenuCommand[] | CxtMenuCommand[];
  fillColor?: string;
  activeFillColor?: string;
  activePadding?: number;
  indicatorSize?: number;
  separatorWidth?: number;
  spotlightPadding?: number;
  adaptativeNodeSpotlightRadius?: boolean;
  minSpotlightRadius?: number;
  maxSpotlightRadius?: number;
  openMenuEvents?: string;
  itemColor?: string;
  itemTextShadowColor?: string;
  zIndex?: number;
  atMouse?: boolean;
  outsideMenuCancel?: number;
}

export interface CxtMenuInstance {
  destroy: () => void;
}

declare module 'cytoscape' {
  interface Core {
    cxtmenu(options: CxtMenuOptions): CxtMenuInstance;
  }
}
