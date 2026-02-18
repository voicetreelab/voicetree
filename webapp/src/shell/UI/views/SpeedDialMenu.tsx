/* eslint-disable react-refresh/only-export-components */
/**
 * SpeedDialMenu (React) - Top-right icon toolbar
 *
 * 3 icon buttons: Settings, Stats, Feedback.
 * Mounted/unmounted via createSpeedDialMenu / disposeSpeedDialMenu.
 */

import { createElement } from 'react';
import type { JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// @ts-expect-error CSS import - types declared in vite-env.d.ts
import './styles/speed-dial-side-graph-floating-menu.css';

// =============================================================================
// Types
// =============================================================================

export interface SpeedDialCallbacks {
  onToggleDarkMode: () => void;
  onSettings?: () => void;
  onAbout?: () => void;
  onStats?: () => void;
  onFeedback?: () => void;
}

type IconName = 'settings' | 'bar-chart' | 'message-square';

// =============================================================================
// SVG Icon Paths
// =============================================================================

const ICON_PATHS: Record<IconName, string[]> = {
  settings: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  ],
  'bar-chart': ['M12 20V10', 'M18 20V4', 'M6 20v-4'],
  'message-square': ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
};

// =============================================================================
// Icon Component
// =============================================================================

function SpeedDialIcon({ name }: { name: IconName }): JSX.Element {
  const paths: string[] = ICON_PATHS[name];
  return (
    <svg
      className="speed-dial-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d: string, i: number) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// =============================================================================
// Main Component
// =============================================================================

interface ToolbarItem {
  id: string;
  label: string;
  iconName: IconName;
  onClick: () => void;
}

function SpeedDialMenuInternal({ callbacks }: { readonly callbacks: SpeedDialCallbacks }): JSX.Element {
  const items: ToolbarItem[] = [
    {
      id: 'settings',
      label: 'Settings',
      iconName: 'settings',
      onClick: callbacks.onSettings ?? ((): void => { /* no-op */ }),
    },
    {
      id: 'stats',
      label: 'Stats',
      iconName: 'bar-chart',
      onClick: callbacks.onStats ?? ((): void => { /* no-op */ }),
    },
    {
      id: 'feedback',
      label: 'Feedback',
      iconName: 'message-square',
      onClick: callbacks.onFeedback ?? ((): void => { /* no-op */ }),
    },
  ];

  return (
    <div className="speed-dial-container">
      {items.map((item: ToolbarItem) => (
        <button
          key={item.id}
          className="speed-dial-item"
          title={item.label}
          aria-label={item.label}
          onClick={(e: React.MouseEvent): void => {
            e.stopPropagation();
            item.onClick();
          }}
        >
          <SpeedDialIcon name={item.iconName} />
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Mount / Unmount (public API)
// =============================================================================

let root: Root | null = null;

/**
 * Create and mount the speed dial menu into a parent container.
 * @returns cleanup function
 */
export function createSpeedDialMenu(
  container: HTMLElement,
  callbacks: SpeedDialCallbacks,
  _isDarkMode: boolean,
): () => void {
  disposeSpeedDialMenu();

  const mountPoint: HTMLDivElement = document.createElement('div');
  mountPoint.setAttribute('data-testid', 'speed-dial-menu-mount');
  container.appendChild(mountPoint);

  root = createRoot(mountPoint);
  root.render(createElement(SpeedDialMenuInternal, { callbacks }));

  return disposeSpeedDialMenu;
}

/**
 * Dispose the speed dial menu and clean up resources.
 */
export function disposeSpeedDialMenu(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}

/**
 * No-op — dark mode toggle removed from toolbar.
 * Kept for API compatibility with orchestration layer.
 */
export function updateSpeedDialDarkMode(_isDarkMode: boolean): void {
  // no-op
}
