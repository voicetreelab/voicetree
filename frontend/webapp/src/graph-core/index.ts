console.log('[GraphCore] Module loading...');
import './styles/floating-windows.css';
import cytoscape from 'cytoscape';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerFloatingWindows } from './extensions/cytoscape-floating-windows';
import { MarkdownEditor } from '@/components/floating-windows/editors/MarkdownEditor';
import { Terminal } from '@/components/floating-windows/editors/Terminal';
import { TestComponent } from '@/components/floating-windows/editors/TestComponent';

// Register floating windows extension immediately at module load
// This must happen before any CytoscapeCore instances are created
console.log('[GraphCore] Registering floating windows extension...');
registerFloatingWindows(cytoscape, {
  React,
  ReactDOM,
  components: {
    MarkdownEditor,
    Terminal,
    TestComponent
  }
});
console.log('[GraphCore] Floating windows extension registered');

export { CytoscapeCore } from './graphviz/CytoscapeCore';
export { type Node, type MarkdownTree, type NodeDefinition, type EdgeDefinition } from './types';
export { registerFloatingWindows, type ExtensionConfig } from './extensions/cytoscape-floating-windows';
console.log('[GraphCore] Module loaded');