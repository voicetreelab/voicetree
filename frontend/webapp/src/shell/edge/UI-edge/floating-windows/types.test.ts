import {describe, it, expect} from 'vitest';
import * as O from 'fp-ts/lib/Option.js';
import type {NodeIdAndFilePath} from "@/pure/graph";
import {
    isImageViewerData,
    getImageViewerId,
    createImageViewerData,
    isEditorData,
    isTerminalData,
    createEditorData,
    createTerminalData,
    type ImageViewerId,
    type FloatingWindowData,
    type ImageViewerData,
    type EditorData,
    type TerminalData,
} from './types';

describe('ImageViewerData types', () => {
    const testImageNodeId: NodeIdAndFilePath = '/path/to/image.png' as NodeIdAndFilePath;
    const testAnchorNodeId: NodeIdAndFilePath = '/path/to/note.md' as NodeIdAndFilePath;

    describe('ImageViewerData structure', () => {
        it('should have type "ImageViewer"', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(imageViewer.type).toBe('ImageViewer');
        });

        it('should contain imageNodeId field', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(imageViewer.imageNodeId).toBe(testImageNodeId);
        });

        it('should contain title field', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'my-image.png'
            });
            expect(imageViewer.title).toBe('my-image.png');
        });

        it('should have anchoredToNodeId as Option.none when not provided', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(O.isNone(imageViewer.anchoredToNodeId)).toBe(true);
        });

        it('should have anchoredToNodeId as Option.some when provided', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image',
                anchoredToNodeId: testAnchorNodeId
            });
            expect(O.isSome(imageViewer.anchoredToNodeId)).toBe(true);
            if (O.isSome(imageViewer.anchoredToNodeId)) {
                expect(imageViewer.anchoredToNodeId.value).toBe(testAnchorNodeId);
            }
        });

        it('should have default shadowNodeDimensions', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(imageViewer.shadowNodeDimensions).toEqual({width: 480, height: 400});
        });

        it('should allow custom shadowNodeDimensions', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image',
                shadowNodeDimensions: {width: 800, height: 600}
            });
            expect(imageViewer.shadowNodeDimensions).toEqual({width: 800, height: 600});
        });

        it('should have resizable default to true', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(imageViewer.resizable).toBe(true);
        });
    });

    describe('isImageViewerData type guard', () => {
        it('should return true for ImageViewerData', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            expect(isImageViewerData(imageViewer)).toBe(true);
        });

        it('should return false for EditorData', () => {
            const editor: EditorData = createEditorData({
                contentLinkedToNodeId: testImageNodeId,
                title: 'Test Editor'
            });
            expect(isImageViewerData(editor)).toBe(false);
        });

        it('should return false for TerminalData', () => {
            const terminal: TerminalData = createTerminalData({
                attachedToNodeId: testAnchorNodeId,
                terminalCount: 1,
                title: 'Test Terminal'
            });
            expect(isImageViewerData(terminal)).toBe(false);
        });
    });

    describe('getImageViewerId', () => {
        it('should derive ID from imageNodeId', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            const id: ImageViewerId = getImageViewerId(imageViewer);
            expect(id).toBe(`${testImageNodeId}-image-viewer`);
        });

        it('should return branded ImageViewerId type', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            const id: ImageViewerId = getImageViewerId(imageViewer);
            expect(typeof id).toBe('string');
        });
    });

    describe('createImageViewerData factory', () => {
        it('should create valid ImageViewerData with minimal params', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });

            expect(imageViewer.type).toBe('ImageViewer');
            expect(imageViewer.imageNodeId).toBe(testImageNodeId);
            expect(imageViewer.title).toBe('Test Image');
            expect(imageViewer.resizable).toBe(true);
            expect(O.isNone(imageViewer.anchoredToNodeId)).toBe(true);
        });

        it('should create valid ImageViewerData with all params', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Full Test Image',
                anchoredToNodeId: testAnchorNodeId,
                resizable: false,
                shadowNodeDimensions: {width: 640, height: 480}
            });

            expect(imageViewer.type).toBe('ImageViewer');
            expect(imageViewer.imageNodeId).toBe(testImageNodeId);
            expect(imageViewer.title).toBe('Full Test Image');
            expect(imageViewer.resizable).toBe(false);
            expect(imageViewer.shadowNodeDimensions).toEqual({width: 640, height: 480});
            expect(O.isSome(imageViewer.anchoredToNodeId)).toBe(true);
        });
    });

    describe('FloatingWindowData union includes ImageViewerData', () => {
        it('should accept ImageViewerData in FloatingWindowData type', () => {
            const imageViewer: ImageViewerData = createImageViewerData({
                imageNodeId: testImageNodeId,
                title: 'Test Image'
            });
            const floatingWindow: FloatingWindowData = imageViewer;
            expect(floatingWindow.type).toBe('ImageViewer');
        });

        it('existing type guards should still work after union update', () => {
            const editor: EditorData = createEditorData({
                contentLinkedToNodeId: testImageNodeId,
                title: 'Test Editor'
            });
            const terminal: TerminalData = createTerminalData({
                attachedToNodeId: testAnchorNodeId,
                terminalCount: 1,
                title: 'Test Terminal'
            });

            expect(isEditorData(editor)).toBe(true);
            expect(isTerminalData(terminal)).toBe(true);
        });
    });
});
