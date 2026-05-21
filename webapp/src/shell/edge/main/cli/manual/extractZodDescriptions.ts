/**
 * Walk a zod input-schema map and produce a flat
 * `{path -> description}` map. `path` is the parameter name for top-level
 * fields, and uses dotted/array notation for nested types
 * (`nodes[].filename`, `override_with_rationale[].ruleId`, …) to match the
 * convention used in `tools/prompts/cli-manual.md`.
 *
 * Only descriptions set via `.describe(...)` are collected — schemas without
 * a description are silently skipped (they appear in zod but never surface
 * to clients, so the manual does not list them either).
 */

type ZodLikeDef = {
    readonly type?: string
    readonly innerType?: ZodLike
    readonly element?: ZodLike
}

type ZodLikeShape = {
    readonly [key: string]: ZodLike
}

type ZodLike = {
    readonly description?: string
    readonly _def?: ZodLikeDef
    readonly shape?: ZodLikeShape
    readonly element?: ZodLike
    readonly unwrap?: () => ZodLike
}

export type ZodInputSchema = {
    readonly [key: string]: ZodLike
}

export function extractZodDescriptions(inputSchema: ZodInputSchema): Map<string, string> {
    const out: Map<string, string> = new Map()
    for (const [key, schema] of Object.entries(inputSchema)) {
        walk(schema, key, out)
    }
    return out
}

function walk(schema: ZodLike, currentPath: string, out: Map<string, string>): void {
    if (typeof schema.description === 'string' && schema.description.length > 0) {
        out.set(currentPath, schema.description)
    }

    const unwrapped: ZodLike = unwrap(schema)
    const defType: string | undefined = unwrapped._def?.type

    if (defType === 'object' && unwrapped.shape) {
        for (const [k, v] of Object.entries(unwrapped.shape)) {
            walk(v, `${currentPath}.${k}`, out)
        }
        return
    }

    if (defType === 'array' && unwrapped.element) {
        walk(unwrapped.element, `${currentPath}[]`, out)
    }
}

function unwrap(schema: ZodLike): ZodLike {
    let current: ZodLike = schema
    while (isWrapper(current)) {
        current = current.unwrap !== undefined ? current.unwrap() : (current._def?.innerType as ZodLike)
    }
    return current
}

function isWrapper(schema: ZodLike): boolean {
    const type: string | undefined = schema._def?.type
    return type === 'optional' || type === 'nullable' || type === 'default'
}
