import type {NodeIdAndFilePath} from "@/pure/graph";
import type {FloatingWindowFields} from "@/shell/edge/UI-edge/floating-windows/types";

export type ImageViewerData = FloatingWindowFields & {
    readonly type: 'ImageViewer';
    readonly imageNodeId: NodeIdAndFilePath;
};

export type CreateImageViewerDataParams = {
    readonly imageNodeId: NodeIdAndFilePath;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath;
    readonly resizable?: boolean;
    readonly shadowNodeDimensions?: { width: number; height: number };
};
