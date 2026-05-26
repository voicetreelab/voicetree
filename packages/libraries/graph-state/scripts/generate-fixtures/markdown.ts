function renderScalar(value: string | number | boolean): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function renderYamlValue(value: unknown, indent: string = ''): readonly string[] {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [`${indent}${renderScalar(value)}`]
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return [`${indent}[]`]
        }

        return value.flatMap((entry) => {
            if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
                return [`${indent}- ${renderScalar(entry)}`]
            }
            if (!isPlainObject(entry)) {
                throw new Error(`Unsupported YAML array entry: ${JSON.stringify(entry)}`)
            }
            const nested = renderYamlObject(entry, `${indent}  `)
            return [`${indent}-`, ...nested]
        })
    }

    if (isPlainObject(value)) {
        return renderYamlObject(value, indent)
    }

    throw new Error(`Unsupported YAML value: ${JSON.stringify(value)}`)
}

function renderYamlObject(value: Record<string, unknown>, indent: string = ''): readonly string[] {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
        if (
            typeof nestedValue === 'string'
            || typeof nestedValue === 'number'
            || typeof nestedValue === 'boolean'
        ) {
            return [`${indent}${key}: ${renderScalar(nestedValue)}`]
        }

        return [`${indent}${key}:`, ...renderYamlValue(nestedValue, `${indent}  `)]
    })
}

export function markdown(
    title: string,
    paragraphs: readonly string[],
    frontmatter?: Record<string, unknown>,
): string {
    const yaml = frontmatter && Object.keys(frontmatter).length > 0
        ? `---\n${renderYamlObject(frontmatter).join('\n')}\n---\n`
        : ''

    const body = [`# ${title}`, ...paragraphs]
        .filter((line) => line.length > 0)
        .join('\n\n')

    return `${yaml}${body}\n`
}
