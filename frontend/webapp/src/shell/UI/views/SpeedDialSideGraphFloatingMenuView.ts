/**
 * SpeedDialSideGraphFloatingMenuView - Vanilla TypeScript implementation of speed dial menu
 *
 * Features:
 * - Pure vanilla DOM manipulation (no React/JSX)
 * - Reuses existing CSS from speed-dial-side-graph-floating-menu.css
 * - Provides callbacks for menu actions
 * - Supports dark mode icon toggling
 * - Extends Disposable for proper cleanup
 */

import { Disposable } from './Disposable';
import '@/shell/UI/views/styles/speed-dial-side-graph-floating-menu.css';

export interface SpeedDialMenuViewOptions {
  onToggleDarkMode: () => void;
  onBackup: () => void;
  onSettings?: () => void;
  onAbout?: () => void;
  onStats?: () => void;
  isDarkMode: boolean;
}

interface MenuItem {
  id: string;
  label: string;
  iconName: 'sun' | 'moon' | 'settings' | 'download' | 'info' | 'bar-chart';
  onClick: () => void;
  isDanger?: boolean;
}

export class SpeedDialSideGraphFloatingMenuView extends Disposable {
  private container: HTMLElement;
  private menuContainer: HTMLElement;
  private options: SpeedDialMenuViewOptions;
  private menuItems: MenuItem[];
  private buttonElements: HTMLButtonElement[] = [];
  private hoveredIndex: number | null = null;

  constructor(container: HTMLElement, options: SpeedDialMenuViewOptions) {
    super();
    this.container = container;
    this.options = options;

    // Define menu items
    this.menuItems = [
      {
        id: 'dark-mode',
        label: options.isDarkMode ? 'Light Mode' : 'Dark Mode',
        iconName: options.isDarkMode ? 'sun' : 'moon',
        onClick: options.onToggleDarkMode,
      },
      {
        id: 'settings',
        label: 'Settings',
        iconName: 'settings',
        onClick: options.onSettings ?? (() => console.log('[SpeedDial] Settings clicked')),
      },
      {
        id: 'backup',
        label: 'Backup',
        iconName: 'download',
        onClick: options.onBackup,
        isDanger: true,
      },
      {
        id: 'about',
        label: 'About',
        iconName: 'info',
        onClick: options.onAbout ?? (() => console.log('[SpeedDial] About clicked')),
      },
      {
        id: 'stats',
        label: 'Stats',
        iconName: 'bar-chart',
        onClick: options.onStats ?? (() => console.log('[SpeedDial] Stats clicked')),
      },
    ];

    // Create DOM structure
    this.menuContainer = this.createMenuContainer();
    this.container.appendChild(this.menuContainer);

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Create the main menu container with all buttons
   */
  private createMenuContainer(): HTMLElement {
    const container: HTMLDivElement = document.createElement('div');
    container.className = 'speed-dial-container';

    this.menuItems.forEach((item, index) => {
      const button: HTMLButtonElement = this.createMenuItem(item, index);
      this.buttonElements.push(button);
      container.appendChild(button);
    });

    return container;
  }

  /**
   * Create a single menu item button
   */
  private createMenuItem(item: MenuItem, index: number): HTMLButtonElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.className = `speed-dial-item speed-dial-item-${index}`;
    if (item.isDanger) {
      button.className += ' speed-dial-danger';
    }
    button.setAttribute('aria-label', item.label);
    button.setAttribute('data-item-relativeFilePathIsID', item.id);

    // Create icon
    const icon: SVGElement = this.createIcon(item.iconName);
    button.appendChild(icon);

    // Create label
    const label: HTMLSpanElement = document.createElement('span');
    label.className = 'speed-dial-label';
    label.textContent = item.label;
    button.appendChild(label);

    // Add click handler
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      item.onClick();
    });

    return button;
  }

  /**
   * Create an SVG icon element
   */
  private createIcon(name: 'sun' | 'moon' | 'settings' | 'download' | 'info' | 'bar-chart'): SVGElement {
    const svg: SVGSVGElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'speed-dial-icon');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    // Icon paths for each type
    const paths: Record<string, string[]> = {
      sun: [
        'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707',
        'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
      ],
      moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
      settings: [
        'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
        'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
      ],
      download: [
        'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
        'M7 10l5 5 5-5',
        'M12 15V3',
      ],
      info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
      'bar-chart': ['M12 20V10', 'M18 20V4', 'M6 20v-4'],
    };

    paths[name].forEach((d) => {
      const path: SVGPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });

    return svg;
  }

  /**
   * Setup hover event listeners for proximity scaling
   */
  private setupEventListeners(): void {
    // Track mouse position over container for proximity effects
    this.menuContainer.addEventListener('mousemove', (e) => {
      this.handleMouseMove(e);
    });

    this.menuContainer.addEventListener('mouseleave', () => {
      this.handleMouseLeave();
    });
  }

  /**
   * Handle mouse movement for proximity scaling
   */
  private handleMouseMove(e: MouseEvent): void {
    const containerRect: DOMRect = this.menuContainer.getBoundingClientRect();
    const mouseY: number = e.clientY - containerRect.top;

    // Find which item is closest to mouse
    let closestIndex: number = -1;
    let closestDistance: number = Infinity;

    this.buttonElements.forEach((button, index) => {
      const rect: DOMRect = button.getBoundingClientRect();
      const buttonY: number = rect.top - containerRect.top + rect.height / 2;
      const distance: number = Math.abs(mouseY - buttonY);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    this.hoveredIndex = closestIndex;
    this.updateButtonScales();
  }

  /**
   * Handle mouse leaving the container
   */
  private handleMouseLeave(): void {
    this.hoveredIndex = null;
    this.updateButtonScales();
  }

  /**
   * Update button scales based on hover state
   */
  private updateButtonScales(): void {
    this.buttonElements.forEach((button, index) => {
      // Remove previous hover classes
      button.classList.remove('speed-dial-item-hovered', 'speed-dial-item-near');

      if (this.hoveredIndex === null) {
        // No hover - reset scale
        button.style.setProperty('--scale', '1');
      } else {
        // Calculate scale based on distance from hovered item
        const distance: number = Math.abs(index - this.hoveredIndex);

        if (distance === 0) {
          // Hovered item - scale 1.2x
          button.classList.add('speed-dial-item-hovered');
          button.style.setProperty('--scale', '1.2');
        } else if (distance === 1) {
          // Adjacent items - scale 1.1x
          button.classList.add('speed-dial-item-near');
          button.style.setProperty('--scale', '1.1');
        } else {
          // Far items - no scale
          button.style.setProperty('--scale', '1');
        }
      }
    });
  }

  /**
   * Update dark mode icon and label
   */
  updateDarkMode(isDarkMode: boolean): void {
    this.options.isDarkMode = isDarkMode;

    // Find the dark mode button
    const darkModeItem: MenuItem | undefined = this.menuItems.find((item) => item.id === 'dark-mode');
    if (!darkModeItem) return;

    const darkModeIndex: number = this.menuItems.indexOf(darkModeItem);
    const button: HTMLButtonElement = this.buttonElements[darkModeIndex];
    if (!button) return;

    // Update icon and label
    const newIconName: "sun" | "moon" = isDarkMode ? 'sun' : 'moon';
    const newLabel: "Light Mode" | "Dark Mode" = isDarkMode ? 'Light Mode' : 'Dark Mode';

    // Update menu item data
    darkModeItem.iconName = newIconName;
    darkModeItem.label = newLabel;

    // Update DOM
    const icon: Element | null = button.querySelector('.speed-dial-icon');
    const label: Element | null = button.querySelector('.speed-dial-label');

    if (icon) {
      const newIcon: SVGElement = this.createIcon(newIconName);
      icon.replaceWith(newIcon);
    }

    if (label) {
      label.textContent = newLabel;
    }

    button.setAttribute('aria-label', newLabel);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    // Remove from DOM
    if (this.menuContainer && this.menuContainer.parentElement) {
      this.menuContainer.parentElement.removeChild(this.menuContainer);
    }

    // Clear references
    this.buttonElements = [];

    super.dispose();
  }
}
