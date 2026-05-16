// Folder-handle mockup — thin wrapper around the shared browser-only harness.
//
// All the real work (cy bootstrap, sample graph, FolderHandleService wiring,
// hover/anchored editor stubs, theme + reset controls) lives in ../_harness/.
// This file just supplies the page copy that's specific to the folder-handle
// demo. New mockups should follow the same pattern — see ../_harness/README.md.

import { mountMockupHarness } from '../_harness'

const root: HTMLElement | null = document.getElementById('root')
if (!root) throw new Error('folder-handle mockup: #root not found in index.html')

mountMockupHarness({
    root,
    title: 'Folder handle — interactive mockup',
    introHtml:
        'This page wires the <strong>real</strong> <code>FolderHandleService</code> from ' +
        '<code>webapp/src/shell/UI/cytoscape-graph-ui/services/folder-handle/</code> into a ' +
        'stand-alone cytoscape canvas. The only stubs are <code>window.electronAPI</code> ' +
        '(so the chevron\'s collapse/expand IPC has somewhere to land) and the sample graph.',
    legend: [
        { html: '<b>Chevron click</b> → real <code>toggleFolderCollapse</code> path → stub IPC → cy mutation.' },
        { html: '<b>Folder body</b> is <code>ungrabify()</code>\'d: pan + right-click pass through to the canvas.' },
        { html: '<b>Hover the folder body</b> → no grab cursor (matches the shipped mouseover early-return).' },
        { html: '<b>Collapsed folder</b> = 40×40 pill, grabbable, no DOM chip (the cy node IS the chip).' },
        { html: '<b>Click a collapsed pill</b> → expand. The stub rebuilds cy (see note); production routes via daemon IPC.' },
        { html: '<b>Hover any node / folder</b> → transient editor pops up beneath it (stub of <code>HoverEditor.ts</code>).' },
        { html: '<b>Click a node / folder body</b> → anchors the editor (stub of <code>AnchoredEditor.ts</code>); click again to un-pin.' },
    ],
    noteHtml:
        'Heads-up: in-place expand stresses a compound-bounds re-entrancy in the shipped chip ' +
        'listener (positionChip reads bbox synchronously inside its own <code>bounds</code> event handler). ' +
        'Production hides this via daemon-async IPC + <code>applyGraphDeltaToUI</code>\'s remove/re-add cycle; ' +
        'the stub here rebuilds the cy instance instead — same end state.',
    footerHint: 'Right-click anywhere inside the dashed folder body — it should pass through. Drag the chevron-less area to pan.',
})
