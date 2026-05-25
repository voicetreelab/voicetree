import {describe, expect, it} from 'vitest'
import {buildCallDagIndex, callDagFingerprint} from './call-dag-fingerprint'
import {extractFunctionsFromSource, type FunctionRecord} from './extract-functions'

function recordsFrom(relativePath: string, packageName: string, source: string): FunctionRecord[] {
    return extractFunctionsFromSource(
        {
            absolutePath: `/virtual/${relativePath}`,
            relativePath,
            packageName,
        },
        source,
    )
}

function findFunction(records: readonly FunctionRecord[], name: string): FunctionRecord {
    const match = records.find(record => record.name === name)
    if (!match) throw new Error(`fixture missing function: ${name} (have: ${records.map(r => r.name).join(', ')})`)
    return match
}

describe('callDagFingerprint', () => {
    it('produces the same canonical hash for two workflows with semantically-equivalent leaves', () => {
        // Both pipelines: load → validate → persist, identical leaf shapes,
        // different names everywhere. Each helper has enough tokens to
        // survive the extractor's MIN_TOKEN_COUNT filter.
        const pipelineA = recordsFrom('a/src/a.ts', 'pkg-a', `
            export async function parseJsonFromDisk(path) {
                const raw = await readFile(path)
                const parsed = JSON.parse(raw)
                return parsed
            }
            export function validate(payload) {
                if (!payload) throw new Error('missing payload')
                if (!payload.id) throw new Error('missing id')
                if (!payload.name) throw new Error('missing name')
                return payload
            }
            export async function store(payload) {
                const blob = JSON.stringify(payload)
                await writeFile('/tmp/store.json', blob)
                return payload.id
            }
            export async function ingestA(path) {
                const data = await parseJsonFromDisk(path)
                const ok = validate(data)
                const stored = await store(ok)
                return stored
            }
        `)

        const pipelineB = recordsFrom('b/src/b.ts', 'pkg-b', `
            export async function readAndParse(filepath) {
                const blob = await readFile(filepath)
                const parsed = JSON.parse(blob)
                return parsed
            }
            export function check(payloadObject) {
                if (!payloadObject) throw new Error('missing payloadObject')
                if (!payloadObject.id) throw new Error('missing id')
                if (!payloadObject.name) throw new Error('missing name')
                return payloadObject
            }
            export async function persist(payloadObject) {
                const blob = JSON.stringify(payloadObject)
                await writeFile('/tmp/store.json', blob)
                return payloadObject.id
            }
            export async function ingestB(filepath) {
                const fetched = await readAndParse(filepath)
                const verified = check(fetched)
                const persisted = await persist(verified)
                return persisted
            }
        `)

        const all = [...pipelineA, ...pipelineB]
        const index = buildCallDagIndex(all)
        const fpA = callDagFingerprint(findFunction(pipelineA, 'ingestA'), index)
        const fpB = callDagFingerprint(findFunction(pipelineB, 'ingestB'), index)

        expect(fpA.canonicalHash).toBe(fpB.canonicalHash)
        expect(fpA.canonical).toBe(fpB.canonical)
        expect(fpA.edgeSet.size).toBeGreaterThan(0)
    })

    it('distinguishes workflows whose leaf shapes diverge', () => {
        const fileA = recordsFrom('a/src/a.ts', 'pkg-a', `
            export function loadJson(path) {
                const text = readFileSync(path)
                const parsed = JSON.parse(text)
                return parsed
            }
            export function workflowA(path, alsoPath) {
                const first = loadJson(path)
                const second = loadJson(alsoPath)
                const combined = {first, second}
                return combined
            }
        `)
        const fileB = recordsFrom('b/src/b.ts', 'pkg-b', `
            export function loop(items) {
                let total = 0
                for (const item of items) {
                    total = total + item
                }
                return total
            }
            export function workflowB(items, alsoItems) {
                const first = loop(items)
                const second = loop(alsoItems)
                const combined = {first, second}
                return combined
            }
        `)

        const index = buildCallDagIndex([...fileA, ...fileB])
        const fpA = callDagFingerprint(findFunction(fileA, 'workflowA'), index)
        const fpB = callDagFingerprint(findFunction(fileB, 'workflowB'), index)
        expect(fpA.canonicalHash).not.toBe(fpB.canonicalHash)
    })

    it('marks unknown callees as external and counts them in the edgeSet', () => {
        const records = recordsFrom('a/src/a.ts', 'pkg-a', `
            export async function workflow(path) {
                const raw = await readFile(path)
                const parsed = JSON.parse(raw)
                await writeFile('out', parsed)
                return parsed
            }
        `)
        const index = buildCallDagIndex(records)
        const fp = callDagFingerprint(findFunction(records, 'workflow'), index)

        const edges = [...fp.edgeSet]
        expect(edges.some(edge => edge.includes('>ext:readFile'))).toBe(true)
        expect(edges.some(edge => edge.includes('>ext:parse'))).toBe(true)
        expect(edges.some(edge => edge.includes('>ext:writeFile'))).toBe(true)
    })

    it('breaks cycles with a placeholder rather than recursing forever', () => {
        const records = recordsFrom('a/src/a.ts', 'pkg-a', `
            export function pingPongA(value) {
                if (value <= 0) return value
                const next = value - 1
                return pingPongB(next)
            }
            export function pingPongB(value) {
                if (value <= 0) return value
                const next = value - 1
                return pingPongA(next)
            }
        `)
        const index = buildCallDagIndex(records)
        const fp = callDagFingerprint(findFunction(records, 'pingPongA'), index)
        expect(fp.canonical).toContain('cycle:')
    })

    it('respects the configured max depth', () => {
        const records = recordsFrom('a/src/a.ts', 'pkg-a', `
            export function leafFn(value, base) {
                if (value < 0) return 0
                const incremented = value + base
                const doubled = incremented * 2
                return doubled
            }
            export function innerFn(value, base) {
                const first = leafFn(value, base)
                const second = leafFn(value + 1, base)
                return first + second
            }
            export function outerFn(value, base) {
                const first = innerFn(value, base)
                const second = innerFn(value + 1, base)
                return first + second
            }
        `)
        const index = buildCallDagIndex(records)
        const deep = callDagFingerprint(findFunction(records, 'outerFn'), index, {depth: 3})
        const shallow = callDagFingerprint(findFunction(records, 'outerFn'), index, {depth: 1})
        expect(deep.depth).toBeGreaterThan(shallow.depth)
        expect(deep.nodeCount).toBeGreaterThan(shallow.nodeCount)
    })

    it('treats arity-incompatible same-name candidates as unresolved-internal', () => {
        const records = recordsFrom('a/src/a.ts', 'pkg-a', `
            export function helperFn(first, second) {
                if (first > second) return first
                const swapped = second - first
                const doubled = swapped * 2
                return doubled
            }
            export function callerFn(input, base) {
                const intermediate = input + base
                const doubled = intermediate * 2
                const result = helperFn(doubled)
                return result
            }
        `)
        const index = buildCallDagIndex(records)
        const fp = callDagFingerprint(findFunction(records, 'callerFn'), index)
        expect(fp.unresolvedInternalCallees).toBeGreaterThanOrEqual(1)
    })

    it('flags resolution collisions when name+arity matches multiple records', () => {
        const fileA = recordsFrom('a/src/a.ts', 'pkg-a', `
            export function commonHelper(value, base) {
                if (value < 0) return base
                const next = value + base
                const doubled = next * 2
                return doubled
            }
        `)
        const fileB = recordsFrom('b/src/b.ts', 'pkg-b', `
            export function commonHelper(value, base) {
                if (value > 0) return value
                const flipped = -value + base
                const doubled = flipped * 2
                return doubled
            }
        `)
        const caller = recordsFrom('c/src/c.ts', 'pkg-c', `
            export function pipelineCaller(input, base) {
                if (input < 0) return commonHelper(input, base)
                const adjusted = input + 1
                const result = commonHelper(adjusted, base)
                return result
            }
        `)
        const index = buildCallDagIndex([...fileA, ...fileB, ...caller])
        const fp = callDagFingerprint(findFunction(caller, 'pipelineCaller'), index)
        expect(fp.resolutionCollisions).toBeGreaterThanOrEqual(1)
    })
})
