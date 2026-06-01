/**
 * Pure PNG "is this screenshot non-blank?" check, shared by the perf harnesses.
 *
 * Decodes a PNG far enough to sample luminance across each scanline (handling
 * the standard filter predictors) and returns true only when the image has
 * real bright pixels AND contrast — the anti-reward-hack guard that proves a
 * captured screenshot actually shows a rendered graph, not a blank canvas.
 *
 * Pure: takes bytes, returns a boolean. No fs, no logging.
 */
import { inflateSync } from 'node:zlib'

export function pngLooksNonBlank(buffer: Buffer): boolean {
    if (buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return false
    let offset = 8
    let width = 0
    let height = 0
    let colorType = 0
    const idat: Buffer[] = []

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            const bitDepth = data[8]
            colorType = data[9] ?? 0
            if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return false
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    if (width === 0 || height === 0 || idat.length === 0) return false
    const bytesPerPixel = colorType === 6 ? 4 : 3
    const rowBytes = width * bytesPerPixel
    const inflated = inflateSync(Buffer.concat(idat))
    let read = 0
    let previous = Buffer.alloc(rowBytes)
    let darkest = 255
    let brightest = 0
    let sampled = 0

    for (let y = 0; y < height; y++) {
        const filter = inflated[read++] ?? 0
        const row = Buffer.from(inflated.subarray(read, read + rowBytes))
        read += rowBytes

        for (let x = 0; x < rowBytes; x++) {
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0
            const up = previous[x] ?? 0
            const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0
            const p = left + up - upLeft
            const pa = Math.abs(p - left)
            const pb = Math.abs(p - up)
            const pc = Math.abs(p - upLeft)
            const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
            const predictor =
                filter === 1 ? left
                    : filter === 2 ? up
                        : filter === 3 ? Math.floor((left + up) / 2)
                            : filter === 4 ? paeth
                                : 0
            row[x] = ((row[x] ?? 0) + predictor) & 0xff
        }

        const stride = Math.max(1, Math.floor(width / 32))
        for (let x = 0; x < width; x += stride) {
            const i = x * bytesPerPixel
            const luminance = Math.round(
                ((row[i] ?? 0) * 0.2126) + ((row[i + 1] ?? 0) * 0.7152) + ((row[i + 2] ?? 0) * 0.0722),
            )
            darkest = Math.min(darkest, luminance)
            brightest = Math.max(brightest, luminance)
            sampled += 1
        }
        previous = row
    }

    return sampled > 0 && brightest > 20 && (brightest - darkest) > 10
}
