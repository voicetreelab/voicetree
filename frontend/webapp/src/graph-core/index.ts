console.log('[GraphCore] Module loading...');
import './styles/floating-windows.css';
import cytoscape from 'cytoscape';
import { registerFloatingWindows } from './extensions/cytoscape-floating-windows';

// Register floating windows extension immediately at module load
// All floating window components are now vanilla JS (no React)
console.log('[GraphCore] Registering floating windows extension...');
registerFloatingWindows(cytoscape);
console.log('[GraphCore] Floating windows extension registered');

export { type Node, type MarkdownTree, type NodeDefinition, type EdgeDefinition } from './types';
export { registerFloatingWindows } from './extensions/cytoscape-floating-windows';
export { AnimationType } from './services/BreathingAnimationService';
console.log('[GraphCore] Module loaded');