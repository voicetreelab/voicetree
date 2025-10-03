console.log('[GraphCore] Module loading...');
import './styles/floating-windows.css';
import cytoscape from 'cytoscape';
import { registerFloatingWindows } from './extensions/cytoscape-floating-windows';

// Register floating windows extension immediately at module load
// This must happen before any CytoscapeCore instances are created
console.log('[GraphCore] Registering floating windows extension...');
registerFloatingWindows(cytoscape);
console.log('[GraphCore] Floating windows extension registered');

export { CytoscapeCore } from './graphviz/CytoscapeCore';
export { type Node, type MarkdownTree, type NodeDefinition, type EdgeDefinition } from './types';
export { registerFloatingWindows };
console.log('[GraphCore] Module loaded');