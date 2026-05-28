import {mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {clearLoadSchemaPluginCacheForTest, loadSchemaPlugin} from './loadSchemaPlugin'

describe('loadSchemaPlugin', () => {
    let vaultRoot: string

    beforeEach(async () => {
        vaultRoot = await realpath(await mkdtemp(join(tmpdir(), 'vt-load-schema-')))
        clearLoadSchemaPluginCacheForTest()
    })

    afterEach(async () => {
        await rm(vaultRoot, {recursive: true, force: true})
        clearLoadSchemaPluginCacheForTest()
    })

    async function writeSchemasModule(body: string): Promise<string> {
        const voicetreeDir: string = join(vaultRoot, '.voicetree')
        await mkdir(voicetreeDir, {recursive: true})
        const schemasPath: string = join(voicetreeDir, 'schemas.cjs')
        await writeFile(schemasPath, body, 'utf8')
        return schemasPath
    }

    it('returns the ValidatorMap exported from schemas.cjs', async () => {
        await writeSchemasModule(
            `module.exports = {
                "my-kind": {
                    validate(body) {
                        return body.includes("required") ? [] : [{
                            ruleId: "body.missing_required_marker",
                            message: "missing required marker",
                            severity: "error",
                        }]
                    }
                }
            }`
        )

        const plugin = await loadSchemaPlugin(vaultRoot)
        expect(plugin).toBeDefined()
        expect(plugin?.['my-kind']).toBeDefined()
        expect(plugin?.['my-kind'].validate('with required content')).toEqual([])
        expect(plugin?.['my-kind'].validate('missing')).toEqual([
            {ruleId: 'body.missing_required_marker', message: 'missing required marker', severity: 'error'},
        ])
    })

    it('returns undefined when no schemas.cjs exists', async () => {
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        expect(await loadSchemaPlugin(vaultRoot)).toBeUndefined()
    })

    it('returns undefined when the .voicetree dir itself is absent', async () => {
        expect(await loadSchemaPlugin(vaultRoot)).toBeUndefined()
    })

    it('returns undefined when the exported value is not a ValidatorMap', async () => {
        await writeSchemasModule('module.exports = "not an object"')
        expect(await loadSchemaPlugin(vaultRoot)).toBeUndefined()
    })

    it('returns undefined when a validator entry is missing the validate function', async () => {
        await writeSchemasModule(`module.exports = { "broken": { notValidate: () => [] } }`)
        expect(await loadSchemaPlugin(vaultRoot)).toBeUndefined()
    })

    it('rejects schemas.cjs that resolves outside the vault root via symlink', async () => {
        const outsideDir: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-outside-schema-')))
        try {
            const outsideSchemas: string = join(outsideDir, 'schemas.cjs')
            await writeFile(outsideSchemas, 'module.exports = {}', 'utf8')

            const voicetreeDir: string = join(vaultRoot, '.voicetree')
            await mkdir(voicetreeDir, {recursive: true})
            await symlink(outsideSchemas, join(voicetreeDir, 'schemas.cjs'))

            await expect(loadSchemaPlugin(vaultRoot)).rejects.toThrow(/Refusing to load schema plugin/)
        } finally {
            await rm(outsideDir, {recursive: true, force: true})
        }
    })

    it('returns the cached result when the module has not changed', async () => {
        const schemasPath: string = await writeSchemasModule(
            `let count = 0
            module.exports = {
                "my-kind": {
                    validate() {
                        count += 1
                        return count > 1 ? [{ruleId: "test.re_evaluated", message: "re-evaluated", severity: "error"}] : []
                    }
                }
            }`
        )

        const first = await loadSchemaPlugin(vaultRoot)
        const second = await loadSchemaPlugin(vaultRoot)
        expect(first).toBe(second)
        void schemasPath
    })

    it('reloads the module when schemas.cjs mtime changes', async () => {
        await writeSchemasModule(`module.exports = { "my-kind": { validate: () => [] } }`)
        const before = await loadSchemaPlugin(vaultRoot)
        expect(before?.['my-kind']).toBeDefined()

        const newSchemasPath: string = join(vaultRoot, '.voicetree', 'schemas.cjs')
        await writeFile(
            newSchemasPath,
            `module.exports = { "renamed-kind": { validate: () => [] } }`,
            'utf8'
        )
        const future: Date = new Date(Date.now() + 5000)
        await utimes(newSchemasPath, future, future)

        const after = await loadSchemaPlugin(vaultRoot)
        expect(after?.['renamed-kind']).toBeDefined()
        expect(after?.['my-kind']).toBeUndefined()
        expect(after).not.toBe(before)
    })
})
