import {mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {clearLoadSchemaPluginCacheForTest, loadSchemaPlugin} from './loadSchemaPlugin'

describe('loadSchemaPlugin', () => {
    let projectRoot: string

    beforeEach(async () => {
        projectRoot = await realpath(await mkdtemp(join(tmpdir(), 'vt-load-schema-')))
        clearLoadSchemaPluginCacheForTest()
    })

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true})
        clearLoadSchemaPluginCacheForTest()
    })

    async function writeSchemasModule(body: string): Promise<string> {
        const voicetreeDir: string = join(projectRoot, '.voicetree')
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

        const plugin = await loadSchemaPlugin(projectRoot)
        expect(plugin).toBeDefined()
        expect(plugin?.['my-kind']).toBeDefined()
        expect(plugin?.['my-kind'].validate('with required content')).toEqual([])
        expect(plugin?.['my-kind'].validate('missing')).toEqual([
            {ruleId: 'body.missing_required_marker', message: 'missing required marker', severity: 'error'},
        ])
    })

    it('returns undefined when no schemas.cjs exists', async () => {
        await mkdir(join(projectRoot, '.voicetree'), {recursive: true})
        expect(await loadSchemaPlugin(projectRoot)).toBeUndefined()
    })

    it('returns undefined when the .voicetree dir itself is absent', async () => {
        expect(await loadSchemaPlugin(projectRoot)).toBeUndefined()
    })

    it('returns undefined when the exported value is not a ValidatorMap', async () => {
        await writeSchemasModule('module.exports = "not an object"')
        expect(await loadSchemaPlugin(projectRoot)).toBeUndefined()
    })

    it('returns undefined when a validator entry is missing the validate function', async () => {
        await writeSchemasModule(`module.exports = { "broken": { notValidate: () => [] } }`)
        expect(await loadSchemaPlugin(projectRoot)).toBeUndefined()
    })

    it('rejects schemas.cjs that resolves outside the project root via symlink', async () => {
        const outsideDir: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-outside-schema-')))
        try {
            const outsideSchemas: string = join(outsideDir, 'schemas.cjs')
            await writeFile(outsideSchemas, 'module.exports = {}', 'utf8')

            const voicetreeDir: string = join(projectRoot, '.voicetree')
            await mkdir(voicetreeDir, {recursive: true})
            await symlink(outsideSchemas, join(voicetreeDir, 'schemas.cjs'))

            await expect(loadSchemaPlugin(projectRoot)).rejects.toThrow(/Refusing to load schema plugin/)
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

        const first = await loadSchemaPlugin(projectRoot)
        const second = await loadSchemaPlugin(projectRoot)
        expect(first).toBe(second)
        void schemasPath
    })

    it('reloads the module when schemas.cjs mtime changes', async () => {
        await writeSchemasModule(`module.exports = { "my-kind": { validate: () => [] } }`)
        const before = await loadSchemaPlugin(projectRoot)
        expect(before?.['my-kind']).toBeDefined()

        const newSchemasPath: string = join(projectRoot, '.voicetree', 'schemas.cjs')
        await writeFile(
            newSchemasPath,
            `module.exports = { "renamed-kind": { validate: () => [] } }`,
            'utf8'
        )
        const future: Date = new Date(Date.now() + 5000)
        await utimes(newSchemasPath, future, future)

        const after = await loadSchemaPlugin(projectRoot)
        expect(after?.['renamed-kind']).toBeDefined()
        expect(after?.['my-kind']).toBeUndefined()
        expect(after).not.toBe(before)
    })
})
