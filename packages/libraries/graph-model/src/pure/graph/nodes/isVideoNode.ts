/**
 * Video file extensions supported by Voicetree
 * Used to identify video nodes in the graph and detect video wikilinks in the editor
 */
export const VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.webm', '.mov', '.ogg', '.mkv']

import { makeNodeExtensionChecker } from './isImageNode'

export const isVideoNode = makeNodeExtensionChecker(VIDEO_EXTENSIONS)
