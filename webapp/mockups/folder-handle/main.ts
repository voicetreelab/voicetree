// Folder-handle mockup — thin wrapper around the shared browser-only harness.
//
// The harness now runs the REAL folder-node pipeline end-to-end:
//   chevron tap → real folderCollapse → real applyGraphDeltaToUI
//   ⤷ powered by the real graph-state `project()` over a synthetic project.
// See ../_harness/README.md for the dependency layering. This file just
// supplies page copy specific to the folder-handle demo.

import { mountMockupHarness } from '../_harness'

const root: HTMLElement | null = document.getElementById('root')
if (!root) throw new Error('folder-handle mockup: #root not found in index.html')

mountMockupHarness({
    root,
    title: 'Folder nodes — interactive playground (real pipeline)',
    introHtml:
        'This page drives the <strong>real</strong> folder-node pipeline: ' +
        '<code>FolderHandleService</code> → <code>folderCollapse</code> → ' +
        '<code>applyGraphDeltaToUI</code>, with an in-browser daemon running the real ' +
        '<code>project()</code> from <code>@vt/graph-state</code> over a synthetic project.',
    legend: [
        { html: '<b>Chevron click</b> → real <code>toggleFolderCollapse</code> → in-browser daemon → real <code>applyGraphDeltaToUI</code>.' },
        { html: '<b>Folder body</b> is <code>ungrabify()</code>\'d: pan + right-click pass through to the canvas.' },
        { html: '<b>Hover the folder body</b> → no grab cursor (matches the shipped mouseover early-return).' },
        { html: '<b>Collapsed folder</b> = 40×40 pill, grabbable, no DOM chip (the cy node IS the chip).' },
        { html: '<b>Double-click a collapsed pill</b> (or any folder) → expand. Same path as production.' },
        { html: '<b>Hover a file node</b> → real <code>HoverEditor</code> with real CodeMirror, content from <code>fromNodeToContentWithWikilinks(node)</code>.' },
        { html: '<b>Double-click the hover editor</b> → promotes to <code>AnchoredEditor</code> (pinned).' },
    ],
    noteHtml:
        'Edits in CodeMirror are <b>read-only</b> — write IPCs are no-ops, so changes stay in the editor buffer and do NOT round-trip through <code>project()</code>. ' +
        'Stubbed: image viewers, terminals, engagement prompts. Everything else loads verbatim from <code>webapp/src</code>.',
    footerHint: 'Right-click anywhere inside the dashed folder body — it should pass through. Drag the chevron-less area to pan.',
})
