/**
 * Hot Zone C — Surface (b): Folder nodes do NOT trigger Cola re-layout.
 *
 * Black-box (CLAUDE.md): observable signal is the LayoutParticipantSet's
 * public `getCollection()` method. The participant collection is the *input*
 * to ColaLayout (see `autoLayout.ts:154`). If folder operations don't
 * change the participant collection, Cola's input is unchanged — and Cola
 * cannot run on data it never sees.
 *
 * Regression intent: prevents regression of `bccc5449` and BF-075
 * (`26e2e259`). Asserts:
 *   1. Adding/changing a folder-expanded node does not insert it into the
 *      participant collection (Cola excludes it by construction).
 *   2. Running ColaLayout against the participant collection before and
 *      after a folder-only mutation produces *identical* final positions
 *      for non-folder nodes — i.e. the folder operation triggers no Cola
 *      pass that affects them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import type { CollectionReturnValue, Core, NodeSingular, Position } from 'cytoscape';

import ColaLayout from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/cola';
import { DEFAULT_OPTIONS } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/autoLayoutTypes';
import { createLayoutParticipantSet, type LayoutParticipantSet } from './layoutParticipantSet';

type LayoutCtor = new (options: {
    cy: Core;
    eles: CollectionReturnValue;
    randomize: boolean;
    fit: false;
    centerGraph: false;
    nodeDimensionsIncludeLabels: true;
    animate: false;
    avoidOverlap: boolean;
    handleDisconnected: boolean;
    convergenceThreshold: number;
    unconstrIter: number;
    userConstIter: number;
    allConstIter: number;
    nodeSpacing: number;
    edgeLength: number;
    maxSimulationTime: number;
}) => { run: () => void };

const SYNCHRONOUS_LAYOUT_OPTIONS = {
    animate: false as const,
    fit: false as const,
    centerGraph: false as const,
    nodeDimensionsIncludeLabels: true as const,
    randomize: false,
    avoidOverlap: true,
    handleDisconnected: true,
    convergenceThreshold: DEFAULT_OPTIONS.convergenceThreshold ?? 0.4,
    unconstrIter: DEFAULT_OPTIONS.unconstrIter ?? 15,
    userConstIter: DEFAULT_OPTIONS.userConstIter ?? 15,
    allConstIter: DEFAULT_OPTIONS.allConstIter ?? 25,
    nodeSpacing: DEFAULT_OPTIONS.nodeSpacing ?? 120,
    edgeLength: 350,
    maxSimulationTime: 4000,
};

function buildBaseGraph(): Core {
    return cytoscape({
        headless: true,
        styleEnabled: true,
        elements: [
            { data: { id: 'a' }, position: { x: -200, y: 0 } },
            { data: { id: 'b' }, position: { x: 0, y: 0 } },
            { data: { id: 'c' }, position: { x: 200, y: 0 } },
            { data: { id: 'd' }, position: { x: 400, y: 0 } },
            { data: { id: 'e-ab', source: 'a', target: 'b' } },
            { data: { id: 'e-bc', source: 'b', target: 'c' } },
            { data: { id: 'e-cd', source: 'c', target: 'd' } },
        ],
    });
}

function snapshotPositions(cy: Core): Map<string, Position> {
    const out: Map<string, Position> = new Map<string, Position>();
    cy.nodes().forEach((n: NodeSingular): void => {
        const p: Position = n.position();
        out.set(n.id(), { x: p.x, y: p.y });
    });
    return out;
}

function runLayoutOnParticipants(cy: Core, participants: CollectionReturnValue): void {
    const layout: { run: () => void } = new (ColaLayout as unknown as LayoutCtor)({
        cy,
        eles: participants,
        ...SYNCHRONOUS_LAYOUT_OPTIONS,
    });
    layout.run();
}

describe('Hot Zone C (b) — Folder nodes do NOT trigger Cola re-layout', () => {
    const instances: Core[] = [];
    const sets: LayoutParticipantSet[] = [];

    afterEach((): void => {
        while (sets.length > 0) sets.pop()?.dispose();
        while (instances.length > 0) instances.pop()?.destroy();
    });

    it('participant collection excludes a freshly-added folder-expanded node', () => {
        const cy: Core = buildBaseGraph();
        instances.push(cy);
        const set: LayoutParticipantSet = createLayoutParticipantSet(cy);
        sets.push(set);

        const beforeIds: ReadonlySet<string> = new Set(
            set.getCollection().map((ele): string => ele.id()),
        );
        expect(beforeIds.has('a')).toBe(true);
        expect(beforeIds.has('b')).toBe(true);

        // Add an expanded-folder compound (the construct that triggered the
        // bug pre-bccc5449 / pre-BF-075).
        cy.add({ data: { id: 'folder-1', isFolderNode: true } });

        const afterIds: ReadonlySet<string> = new Set(
            set.getCollection().map((ele): string => ele.id()),
        );

        // Folder-expanded compound must NOT be in the layout input.
        expect(afterIds.has('folder-1')).toBe(false);
        // Existing non-folder participants must still be present.
        for (const id of ['a', 'b', 'c', 'd', 'e-ab', 'e-bc', 'e-cd']) {
            expect(afterIds.has(id)).toBe(true);
        }
    });

    it('mutating folder-only data does not enter the participant collection', () => {
        const cy: Core = buildBaseGraph();
        instances.push(cy);
        const set: LayoutParticipantSet = createLayoutParticipantSet(cy);
        sets.push(set);

        cy.add({ data: { id: 'folder-x', isFolderNode: true } });

        // Touch folder-only data many times: each call would have triggered
        // a Cola pass under the pre-fix code (cy 'data' subscription).
        for (let i: number = 0; i < 5; i++) {
            cy.$id('folder-x').data('label', `iter-${i}`);
            cy.$id('folder-x').data('folderLabel', `iter-${i}`);
        }

        const ids: ReadonlySet<string> = new Set(
            set.getCollection().map((ele): string => ele.id()),
        );
        expect(ids.has('folder-x')).toBe(false);
    });

    it('Cola layout output for non-folder nodes is identical with vs without a sibling folder', () => {
        // Ground truth: run Cola on the base graph with no folder.
        const baseline: Core = buildBaseGraph();
        instances.push(baseline);
        const baselineSet: LayoutParticipantSet = createLayoutParticipantSet(baseline);
        sets.push(baselineSet);
        runLayoutOnParticipants(baseline, baselineSet.getCollection());
        const baselinePositions: Map<string, Position> = snapshotPositions(baseline);

        // Same graph + a parentless folder-expanded node. The folder operation
        // is the only new thing — if it leaks into the participant collection,
        // Cola will treat it as input and will perturb non-folder positions.
        const withFolder: Core = buildBaseGraph();
        instances.push(withFolder);
        withFolder.add({ data: { id: 'sibling-folder', isFolderNode: true } });
        const withFolderSet: LayoutParticipantSet = createLayoutParticipantSet(withFolder);
        sets.push(withFolderSet);
        runLayoutOnParticipants(withFolder, withFolderSet.getCollection());
        const withFolderPositions: Map<string, Position> = snapshotPositions(withFolder);

        // Non-folder positions must match exactly between the two runs.
        // (The folder-expanded compound exists in `withFolder` but is never
        // in the Cola input, so it cannot perturb the layout.)
        for (const id of ['a', 'b', 'c', 'd']) {
            const baseP: Position | undefined = baselinePositions.get(id);
            const withP: Position | undefined = withFolderPositions.get(id);
            expect(baseP).toBeDefined();
            expect(withP).toBeDefined();
            expect((withP as Position).x).toBeCloseTo((baseP as Position).x, 6);
            expect((withP as Position).y).toBeCloseTo((baseP as Position).y, 6);
        }
    });
});
