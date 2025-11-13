/**
 * Type definitions for cytoscape-navigator
 * Bird's eye view pan and zoom control for Cytoscape.js
 */

declare module 'cytoscape-navigator' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function register(cytoscape: any): void;

  export = register;
}

// Extend Cytoscape Core with navigator method
declare module 'cytoscape' {
  interface Core {
    navigator(options?: {
      container?: string | false;
      viewLiveFramerate?: number | false;
      thumbnailEventFramerate?: number;
      thumbnailLiveFramerate?: number | false;
      dblClickDelay?: number;
      removeCustomContainer?: boolean;
      rerenderDelay?: number;
    }): { destroy: () => void };
  }
}
