import { describe, it, expect } from 'vitest'
import { isImageNode, IMAGE_EXTENSIONS } from './isImageNode'

describe('isImageNode', () => {
    describe('returns true for image extensions', () => {
        it('returns true for .png files', () => {
            expect(isImageNode('/path/to/image.png')).toBe(true)
        })

        it('returns true for .jpg files', () => {
            expect(isImageNode('/path/to/photo.jpg')).toBe(true)
        })

        it('returns true for .jpeg files', () => {
            expect(isImageNode('/path/to/photo.jpeg')).toBe(true)
        })

        it('returns true for .gif files', () => {
            expect(isImageNode('/path/to/animation.gif')).toBe(true)
        })

        it('returns true for .webp files', () => {
            expect(isImageNode('/path/to/modern.webp')).toBe(true)
        })

        it('returns true for .svg files', () => {
            expect(isImageNode('/path/to/vector.svg')).toBe(true)
        })
    })

    describe('returns false for non-image files', () => {
        it('returns false for .md files', () => {
            expect(isImageNode('/path/to/note.md')).toBe(false)
        })

        it('returns false for .txt files', () => {
            expect(isImageNode('/path/to/file.txt')).toBe(false)
        })

        it('returns false for .js files', () => {
            expect(isImageNode('/path/to/script.js')).toBe(false)
        })

        it('returns false for files without extension', () => {
            expect(isImageNode('/path/to/filename')).toBe(false)
        })
    })

    describe('case-insensitive matching', () => {
        it('returns true for .PNG (uppercase)', () => {
            expect(isImageNode('/path/to/image.PNG')).toBe(true)
        })

        it('returns true for .Jpg (mixed case)', () => {
            expect(isImageNode('/path/to/photo.Jpg')).toBe(true)
        })

        it('returns true for .JPEG (uppercase)', () => {
            expect(isImageNode('/path/to/photo.JPEG')).toBe(true)
        })

        it('returns true for .GIF (uppercase)', () => {
            expect(isImageNode('/path/to/animation.GIF')).toBe(true)
        })

        it('returns true for .WebP (mixed case)', () => {
            expect(isImageNode('/path/to/modern.WebP')).toBe(true)
        })

        it('returns true for .SVG (uppercase)', () => {
            expect(isImageNode('/path/to/vector.SVG')).toBe(true)
        })
    })

    describe('edge cases', () => {
        it('handles relative paths', () => {
            expect(isImageNode('image.png')).toBe(true)
        })

        it('handles nested folder paths', () => {
            expect(isImageNode('subfolder/deep/image.jpg')).toBe(true)
        })

        it('handles files with dots in name', () => {
            expect(isImageNode('/path/to/my.photo.png')).toBe(true)
        })

        it('returns false for image-like names without proper extension', () => {
            expect(isImageNode('/path/to/png')).toBe(false)
        })

        it('returns false for empty string', () => {
            expect(isImageNode('')).toBe(false)
        })
    })
})

describe('IMAGE_EXTENSIONS', () => {
    it('contains all required image extensions', () => {
        expect(IMAGE_EXTENSIONS).toContain('.png')
        expect(IMAGE_EXTENSIONS).toContain('.jpg')
        expect(IMAGE_EXTENSIONS).toContain('.jpeg')
        expect(IMAGE_EXTENSIONS).toContain('.gif')
        expect(IMAGE_EXTENSIONS).toContain('.webp')
        expect(IMAGE_EXTENSIONS).toContain('.svg')
    })

    it('has exactly 6 extensions', () => {
        expect(IMAGE_EXTENSIONS).toHaveLength(6)
    })
})
