import {relative, sep} from 'node:path'

export function isWithin(child: string, ancestor: string): boolean {
    const rel: string = relative(ancestor, child)
    return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}
