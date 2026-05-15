/**
 * IPC handler to read an image file from disk and return it as a data URL.
 * Used by the image viewer to display images without relying on file:// protocol.
 */

import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'

/**
 * Maps file extensions to MIME types for common image formats.
 */
function getMimeType(filePath: string): string {
  const ext: string = extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
  }
  return mimeTypes[ext] ?? 'image/png'
}

/**
 * Reads an image file from disk and returns it as a base64 data URL.
 *
 * @param filePath - Absolute path to the image file
 * @returns Data URL string (e.g., "data:image/png;base64,...") or null if file doesn't exist
 */
export function readImageAsDataUrl(filePath: string): string | null {
  if (!existsSync(filePath)) {
    console.warn(`[readImageAsDataUrl] File not found: ${filePath}`)
    return null
  }

  try {
    const buffer: Buffer = readFileSync(filePath)
    const base64: string = buffer.toString('base64')
    const mimeType: string = getMimeType(filePath)
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error(`[readImageAsDataUrl] Error reading file: ${filePath}`, error)
    return null
  }
}
