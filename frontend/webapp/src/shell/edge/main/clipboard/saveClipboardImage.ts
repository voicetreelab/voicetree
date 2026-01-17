/**
 * IPC handler to save clipboard image to disk as a sibling file to a markdown node.
 * Uses Electron's nativeImage API to read clipboard contents.
 */

import { clipboard } from 'electron'
import type { NativeImage } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Saves the current clipboard image to disk as a sibling to the given markdown file.
 *
 * @param markdownNodeId - Path to the markdown file (used to derive save folder)
 * @returns The relative filename (e.g., "pasted-1705123456789.png") or null if no image in clipboard
 */
export function saveClipboardImage(markdownNodeId: string): string | null {
  const image: NativeImage = clipboard.readImage()

  if (image.isEmpty()) {
    return null
  }

  const pngBuffer: Buffer = image.toPNG()
  const timestamp: number = Date.now()
  const filename: string = `pasted-${timestamp}.png`

  const folder: string = dirname(markdownNodeId)
  const fullPath: string = join(folder, filename)

  writeFileSync(fullPath, pngBuffer)

  return filename
}
