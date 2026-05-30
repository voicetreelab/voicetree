import { describe, it, expect, afterEach } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular } from 'cytoscape';

import {
    applyAnchoredEditorOpenStyle,
    applyAnchoredEditorCloseStyle,
} from './anchoredEditorVisualStyle';

const FOLDER_RULE: cytoscape.StylesheetCSS = {
    selector: 'node[?isFolderNode]',
    style: {
        'shape': 'roundrectangle',
        'background-opacity': 0,
        'border-opacity': 0.5,
    },
};

describe('AnchoredEditor visual style — folder cy node guard', () => {
    let cy: Core | undefined;

    afterEach(() => {
        cy?.destroy();
        cy = undefined;
    });

    function setup(): { cy: Core; folder: NodeSingular; regular: NodeSingular } {
        const instance: Core = cytoscape({
            headless: true,
            styleEnabled: true,
            style: [FOLDER_RULE],
        });
        instance.add({ group: 'nodes', data: { id: 'folder', isFolderNode: true } });
        instance.add({ group: 'nodes', data: { id: 'child', parent: 'folder' } });
        instance.add({ group: 'nodes', data: { id: 'note' } });
        cy = instance;
        return {
            cy: instance,
            folder: instance.getElementById('folder') as NodeSingular,
            regular: instance.getElementById('note') as NodeSingular,
        };
    }

    it('open style does not override folder roundrectangle shape', () => {
        const { folder } = setup();
        expect(folder.style('shape')).toBe('roundrectangle');

        applyAnchoredEditorOpenStyle(folder);

        expect(folder.style('shape')).toBe('roundrectangle');
    });

    it('open style leaves folder events enabled (so folder hover/chip interactions keep working)', () => {
        const { folder } = setup();

        applyAnchoredEditorOpenStyle(folder);

        expect(folder.style('events')).toBe('yes');
    });

    it('close style does not paint the folder bbox as a visible ellipse', () => {
        const { folder } = setup();

        applyAnchoredEditorCloseStyle(folder);

        expect(folder.style('shape')).toBe('roundrectangle');
        // The folder rule sets background-opacity: 0 — must not be overridden to 1.
        expect(Number(folder.style('background-opacity'))).toBe(0);
    });

    it('regular non-folder nodes still get hidden by the open style (preserves anchored editor behavior)', () => {
        const { regular } = setup();

        applyAnchoredEditorOpenStyle(regular);

        expect(Number(regular.style('background-opacity'))).toBe(0);
        expect(regular.style('events')).toBe('no');
    });

    it('regular non-folder nodes are restored by the close style', () => {
        const { regular } = setup();
        applyAnchoredEditorOpenStyle(regular);

        applyAnchoredEditorCloseStyle(regular);

        expect(Number(regular.style('background-opacity'))).toBe(1);
        expect(regular.style('events')).toBe('yes');
    });
});
