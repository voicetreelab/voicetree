import type { Core, NodeSingular } from 'cytoscape';
// @ts-expect-error - cytoscape-cxtmenu doesn't have proper TypeScript definitions
import cxtmenu from 'cytoscape-cxtmenu';
import cytoscape from 'cytoscape';
import { CLASS_EXPANDED } from '@/graph-core/constants';

// Register the extension with cytoscape
cytoscape.use(cxtmenu);

export interface ContextMenuConfig {
  onOpenEditor?: (nodeId: string) => void;
  onOpenTerminal?: (nodeId: string) => void;
  onExpandNode?: (node: NodeSingular) => void;
  onCollapseNode?: (node: NodeSingular) => void;
  onPinNode?: (node: NodeSingular) => void;
  onUnpinNode?: (node: NodeSingular) => void;
  onDeleteNode?: (node: NodeSingular) => void;
  onCopyNodeName?: (nodeId: string) => void;
}

interface MenuCommand {
  content: string | HTMLElement;
  select: (ele: NodeSingular) => void;
  enabled: boolean;
}

export class ContextMenuService {
  private cy: Core | null = null;
  private config: ContextMenuConfig;
  private menuInstance: unknown = null;

  constructor(config: ContextMenuConfig = {}) {
    this.config = config;
  }

  initialize(cy: Core): void {
    this.cy = cy;
    this.setupContextMenu();
  }

  private setupContextMenu(): void {
    if (!this.cy) return;

    // Get theme colors from CSS variables or use defaults
    const style = getComputedStyle(document.body);
    const isDarkMode = document.documentElement.classList.contains('dark');

    const selectColor = style.getPropertyValue('--text-selection').trim() ||
                       (isDarkMode ? '#3b82f6' : '#2563eb');
    const backgroundColor = style.getPropertyValue('--background-secondary').trim() ||
                           (isDarkMode ? '#1f2937' : '#f3f4f6');
    const textColor = style.getPropertyValue('--text-normal').trim() ||
                     (isDarkMode ? '#ffffff' : '#111827');

    const menuOptions = {
      menuRadius: 75,
      selector: 'node',
      commands: (node: NodeSingular) => this.getNodeCommands(node),
      fillColor: backgroundColor,
      activeFillColor: selectColor,
      activePadding: 20,
      indicatorSize: 24,
      separatorWidth: 3,
      spotlightPadding: 4,
      adaptativeNodeSpotlightRadius: true,
      openMenuEvents: 'cxttapstart taphold',
      itemColor: textColor,
      itemTextShadowColor: 'transparent',
      zIndex: 9999,
      atMouse: false,
      outsideMenuCancel: 10,
    };

    // @ts-expect-error - cxtmenu doesn't have proper TypeScript definitions
    this.menuInstance = this.cy.cxtmenu(menuOptions);
  }

  private getNodeCommands(node: NodeSingular): MenuCommand[] {
    const commands: MenuCommand[] = [];
    const nodeId = node.id();
    const isExpanded = node.hasClass(CLASS_EXPANDED);

    // Open in Editor
    if (this.config.onOpenEditor) {
      commands.push({
        content: this.createSvgIcon('edit', 'Edit'),
        select: () => this.config.onOpenEditor?.(nodeId),
        enabled: true,
      });
    }

    // Expand/Collapse
    if (isExpanded && this.config.onCollapseNode) {
      commands.push({
        content: this.createSvgIcon('collapse', 'Collapse'),
        select: () => this.config.onCollapseNode?.(node),
        enabled: true,
      });
    } else if (!isExpanded && this.config.onExpandNode) {
      commands.push({
        content: this.createSvgIcon('expand', 'Expand'),
        select: () => this.config.onExpandNode?.(node),
        enabled: true,
      });
    }

    // Terminal (replaces Pin/Unpin)
    if (this.config.onOpenTerminal) {
      commands.push({
        content: this.createSvgIcon('terminal', 'Terminal'),
        select: () => this.config.onOpenTerminal?.(nodeId),
        enabled: true,
      });
    }

    // Delete node
    if (this.config.onDeleteNode) {
      commands.push({
        content: this.createSvgIcon('trash', 'Delete'),
        select: () => this.config.onDeleteNode?.(node),
        enabled: true,
      });
    }

    // Copy name
    if (this.config.onCopyNodeName) {
      commands.push({
        content: this.createSvgIcon('copy', 'Copy'),
        select: () => this.config.onCopyNodeName?.(nodeId),
        enabled: true,
      });
    }

    return commands;
  }

  private createSvgIcon(type: string, tooltip: string): HTMLElement {
    const div = document.createElement('div');
    div.style.width = '24px';
    div.style.height = '24px';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.title = tooltip;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const paths: Record<string, string> = {
      edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
      expand: 'M12 5v14 M5 12h14',
      collapse: 'M5 12h14',
      pin: 'M12 17v5 M9 10.76a7 7 0 1 0 6 0 M12 2v8',
      unlock: 'M7 11V7a5 5 0 0 1 9.9-1 M3 11h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V11z',
      hide: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
      copy: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
      terminal: 'M4 17l6-6-6-6 M12 19h8',
      trash: 'M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14'
    };

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[type] || paths.edit);
    svg.appendChild(path);
    div.appendChild(svg);

    return div;
  }

  destroy(): void {
    if (this.menuInstance && typeof this.menuInstance.destroy === 'function') {
      this.menuInstance.destroy();
    }
    this.menuInstance = null;
    this.cy = null;
  }

  updateConfig(config: Partial<ContextMenuConfig>): void {
    this.config = { ...this.config, ...config };
    // Reinitialize menu with new config if cy is available
    if (this.cy) {
      // Destroy existing menu instance
      if (this.menuInstance && typeof this.menuInstance.destroy === 'function') {
        this.menuInstance.destroy();
        this.menuInstance = null;
      }
      // Create new menu with updated config
      this.setupContextMenu();
    }
  }
}