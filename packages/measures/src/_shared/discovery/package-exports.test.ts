import {describe, expect, it} from 'vitest'
import type {PackageExports, PackageInfo} from './discover-packages'
import {resolveExportsSubpath, resolveWorkspaceBasePath} from './package-exports'

function makePkg(overrides: Partial<PackageInfo> = {}): PackageInfo {
    return {
        name: '@vt/example',
        dirName: 'example',
        absDir: '/repo/example',
        srcRoot: '/repo/example/src',
        main: undefined,
        exports: undefined,
        ...overrides,
    }
}

describe('resolveExportsSubpath', () => {
    it('returns the string-shorthand value only for the root subpath', () => {
        const exports: PackageExports = './src/index.ts'
        expect(resolveExportsSubpath(exports, '.')).toBe('./src/index.ts')
        expect(resolveExportsSubpath(exports, './sub')).toBe(null)
    })

    it('returns null for subpaths not declared in the exports map', () => {
        const exports: PackageExports = {'.': './src/index.ts'}
        expect(resolveExportsSubpath(exports, './unknown')).toBe(null)
    })

    it('resolves exact subpath entries before wildcard entries', () => {
        const exports: PackageExports = {
            './tools/special': './src/tools/special.ts',
            './tools/*': './src/tools/*',
        }
        expect(resolveExportsSubpath(exports, './tools/special')).toBe('./src/tools/special.ts')
        expect(resolveExportsSubpath(exports, './tools/other')).toBe('./src/tools/other')
    })

    it('resolves wildcard subpaths and substitutes the captured remainder', () => {
        const exports: PackageExports = {
            '.': './src/index.ts',
            './tools/*': './src/tools/*',
        }
        expect(resolveExportsSubpath(exports, './tools/abc')).toBe('./src/tools/abc')
        expect(resolveExportsSubpath(exports, './tools/nested/deep')).toBe('./src/tools/nested/deep')
    })

    it('chooses the longest matching prefix when multiple wildcards apply', () => {
        const exports: PackageExports = {
            './*': './src/*',
            './tools/*': './src/tools/*',
        }
        expect(resolveExportsSubpath(exports, './tools/foo')).toBe('./src/tools/foo')
        expect(resolveExportsSubpath(exports, './misc/foo')).toBe('./src/misc/foo')
    })

    it('honors wildcard targets that remap path segments', () => {
        const exports: PackageExports = {
            './terminals/*': './src/application/terminals/*',
        }
        expect(resolveExportsSubpath(exports, './terminals/foo')).toBe('./src/application/terminals/foo')
    })

    it('honors conditional export objects, preferring import over default over require', () => {
        const both: PackageExports = {'.': {import: './dist/index.js', default: './src/index.ts'}}
        expect(resolveExportsSubpath(both, '.')).toBe('./dist/index.js')

        const defaultOnly: PackageExports = {'.': {default: './src/index.ts', types: './src/index.d.ts'}}
        expect(resolveExportsSubpath(defaultOnly, '.')).toBe('./src/index.ts')

        const requireOnly: PackageExports = {'.': {require: './dist/index.cjs', types: './src/index.d.ts'}}
        expect(resolveExportsSubpath(requireOnly, '.')).toBe('./dist/index.cjs')
    })

    it('ignores the types condition (no runtime presence)', () => {
        const typesOnly: PackageExports = {'.': {types: './src/index.d.ts'}}
        expect(resolveExportsSubpath(typesOnly, '.')).toBe(null)
    })
})

describe('resolveWorkspaceBasePath', () => {
    it('uses exports["."] for root imports', () => {
        const pkg = makePkg({
            name: '@vt/vt-daemon',
            absDir: '/repo/vt-daemon',
            srcRoot: '/repo/vt-daemon/src',
            exports: {'.': './src/agent-runtime/index.ts'},
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/vt-daemon'))
            .toBe('/repo/vt-daemon/src/agent-runtime/index.ts')
    })

    it('falls back to main for root imports when exports["."] is missing', () => {
        const pkg = makePkg({
            name: '@vt/legacy',
            absDir: '/repo/legacy',
            srcRoot: '/repo/legacy/src',
            main: 'src/legacy-entry.ts',
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/legacy')).toBe('/repo/legacy/src/legacy-entry.ts')
    })

    it('falls back to <srcRoot>/index for root imports when neither exports nor main are present', () => {
        const pkg = makePkg({name: '@vt/example'})
        expect(resolveWorkspaceBasePath(pkg, '@vt/example')).toBe('/repo/example/src/index')
    })

    it('resolves a conditional-export object at the root', () => {
        const pkg = makePkg({
            name: '@vt/conditional',
            absDir: '/repo/conditional',
            srcRoot: '/repo/conditional/src',
            exports: {'.': {import: './src/conditional-entry.ts', types: './src/conditional-entry.d.ts'}},
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/conditional'))
            .toBe('/repo/conditional/src/conditional-entry.ts')
    })

    it('resolves subpath imports via exact exports map entries', () => {
        const pkg = makePkg({
            name: '@vt/vt-daemon',
            absDir: '/repo/vt-daemon',
            srcRoot: '/repo/vt-daemon/src',
            exports: {
                '.': './src/agents/index.ts',
                './mcp-config': './src/config/mcp-config-public.ts',
            },
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/vt-daemon/mcp-config'))
            .toBe('/repo/vt-daemon/src/config/mcp-config-public.ts')
    })

    it('resolves subpath imports via wildcard exports that remap segments', () => {
        const pkg = makePkg({
            name: '@vt/agent-runtime',
            absDir: '/repo/agent-runtime',
            srcRoot: '/repo/agent-runtime/src',
            exports: {'./terminals/*': './src/application/terminals/*'},
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/agent-runtime/terminals/foo'))
            .toBe('/repo/agent-runtime/src/application/terminals/foo')
    })

    it('falls back to <srcRoot>/<sub> for undeclared subpaths', () => {
        const pkg = makePkg({
            name: '@vt/example',
            exports: {'.': './src/index.ts'},
        })
        expect(resolveWorkspaceBasePath(pkg, '@vt/example/sub')).toBe('/repo/example/src/sub')
    })
})
