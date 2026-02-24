/**
 * HorizontalMenu — re-exports for menu item types and factory functions.
 *
 * The standalone hover menu class (HorizontalMenuService) was removed because
 * card shells already provide an embedded horizontal menu via createWindowChrome.
 * HoverEditor.setupCommandHover creates card shells on node hover, so the
 * standalone hover menu was redundant and caused duplicate menus.
 */

// Re-export types for consumers
export type { SliderConfig, HorizontalMenuItem, NodeMenuItemsInput, HorizontalMenuElements } from './HorizontalMenuItems';
export { getNodeMenuItems, createHorizontalMenuElement } from './HorizontalMenuItems';
export type { MenuKind, CreateNodeMenuOptions } from './createNodeMenu';
export { createNodeMenu } from './createNodeMenu';
