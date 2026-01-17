import type {NodeIdAndFilePath} from "@/pure/graph";
import * as O from "fp-ts/lib/Option.js";
import {type Option} from "fp-ts/lib/Option.js";
import {getImageViewerId, type ImageViewerId} from "@/shell/edge/UI-edge/floating-windows/types";
import type {ImageViewerData} from "@/shell/edge/UI-edge/floating-windows/image-viewers/imageViewerDataType";

const imageViewers: Map<ImageViewerId, ImageViewerData> = new Map<ImageViewerId, ImageViewerData>();

export function getImageViewers(): Map<ImageViewerId, ImageViewerData> {
    return imageViewers;
}

export function addImageViewer(imageViewer: ImageViewerData): void {
    imageViewers.set(getImageViewerId(imageViewer), imageViewer);
}

export function getImageViewerByNodeId(nodeId: NodeIdAndFilePath): Option<ImageViewerData> {
    for (const viewer of imageViewers.values()) {
        if (viewer.imageNodeId === nodeId) {
            return O.some(viewer);
        }
    }
    return O.none;
}

export function removeImageViewer(viewerId: ImageViewerId): void {
    imageViewers.delete(viewerId);
}

/**
 * Get the current hover image viewer (viewer without anchor).
 * Hover viewers have anchoredToNodeId = O.none, while permanent viewers have O.some(nodeId).
 */
export function getHoverImageViewer(): Option<ImageViewerData> {
    for (const viewer of imageViewers.values()) {
        if (O.isNone(viewer.anchoredToNodeId)) {
            return O.some(viewer);
        }
    }
    return O.none;
}
