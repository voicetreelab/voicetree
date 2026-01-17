import type {NodeIdAndFilePath} from "@/pure/graph";
import type {FloatingWindowFields} from "@/shell/edge/UI-edge/floating-windows/types";

export type EditorData = FloatingWindowFields & {
    readonly type: 'Editor';
    readonly contentLinkedToNodeId: NodeIdAndFilePath;
    readonly initialContent?: string; // ONLY for initial content (e.g. "loading..."). After loading, use GetContentForEditor
};
export type CreateEditorDataParams = {
    readonly contentLinkedToNodeId: NodeIdAndFilePath;
    readonly title: string;
    readonly anchoredToNodeId?: NodeIdAndFilePath; // defaults to O.none
    readonly initialContent?: string;
    readonly resizable?: boolean; // defaults to true
    readonly shadowNodeDimensions?: { width: number; height: number };
};