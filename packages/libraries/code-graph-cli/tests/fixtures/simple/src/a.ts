import {b} from './b.ts'
import {c} from './c.ts'

export function a(): string {
    return b() + c()
}

export function unused(): string {
    return 'unused'
}
