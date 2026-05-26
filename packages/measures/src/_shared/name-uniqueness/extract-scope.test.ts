// Black-box tests for extract-scope and the underlying extract-declarations.
// Both helpers are pure; tests construct synthetic file contents and assert
// on returned declaration arrays.

import {describe, expect, it} from 'vitest'

import {extractDeclarations} from './extract-declarations.ts'
import {extractScopeDeclarations} from './extract-scope.ts'

describe('extractDeclarations', () => {
    it('returns the basename + all top-level export shapes', () => {
        const decls = extractDeclarations('/repo/src/widget.ts', [
            'export function build() {}',
            'export const Defaults = {}',
            'export class Widget {}',
            'export interface Props {}',
            'export type Shape = {a: number}',
            'export enum Mode {On, Off}',
            'export {existing as renamed} from "./other.ts"',  // re-export — excluded
            'export {locally}',
        ].join('\n'))
        const names = decls.map(d => `${d.kind}:${d.name}`).sort()
        expect(names).toEqual([
            'export-class:Widget',
            'export-const:Defaults',
            'export-enum:Mode',
            'export-function:build',
            'export-interface:Props',
            'export-named:locally',
            'export-type:Shape',
            'file:widget',
        ])
    })

    it('strips known file extensions from the basename', () => {
        expect(extractDeclarations('/repo/foo.tsx', '').map(d => d.name)).toEqual(['foo'])
        expect(extractDeclarations('/repo/foo.cjs', '').map(d => d.name)).toEqual(['foo'])
    })

    it('handles default-export function/class shapes', () => {
        const decls = extractDeclarations('/repo/a.ts', [
            'export default function defaultFn() {}',
            'export default class DefaultCls {}',
        ].join('\n'))
        const names = decls.map(d => `${d.kind}:${d.name}`).sort()
        expect(names).toContain('export-function:defaultFn')
        expect(names).toContain('export-class:DefaultCls')
    })
})

describe('extractScopeDeclarations', () => {
    it('new file (previousContent=null) → every declaration is in scope', () => {
        const scope = extractScopeDeclarations({
            filePath: '/repo/new.ts',
            content: 'export function build() {}\nexport const Defaults = {}',
            previousContent: null,
        })
        const names = scope.map(d => `${d.kind}:${d.name}`).sort()
        expect(names).toEqual(['export-const:Defaults', 'export-function:build', 'file:new'])
    })

    it('modified file with only existing decls → empty scope', () => {
        const content = 'export function build() {}'
        const scope = extractScopeDeclarations({
            filePath: '/repo/existing.ts',
            content,
            previousContent: content,
        })
        expect(scope).toHaveLength(0)
    })

    it('modified file with one added export → only the new one is in scope', () => {
        const scope = extractScopeDeclarations({
            filePath: '/repo/file.ts',
            content: 'export function build() {}\nexport function extra() {}',
            previousContent: 'export function build() {}',
        })
        expect(scope.map(d => d.name)).toEqual(['extra'])
    })

    it('modified file where an export was renamed → new name is in scope, old absence is ignored', () => {
        const scope = extractScopeDeclarations({
            filePath: '/repo/file.ts',
            content: 'export function rebuild() {}',
            previousContent: 'export function build() {}',
        })
        expect(scope.map(d => d.name)).toEqual(['rebuild'])
    })

    it('the file basename declaration is not in scope on a modified file (same basename pre/post)', () => {
        const scope = extractScopeDeclarations({
            filePath: '/repo/file.ts',
            content: 'export function extra() {}',
            previousContent: '',
        })
        const kinds = scope.map(d => d.kind).sort()
        expect(kinds).toEqual(['export-function'])
    })
})
