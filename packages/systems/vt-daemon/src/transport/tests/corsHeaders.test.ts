import {describe, expect, it} from 'vitest'
import {isLocalhostOrigin, parseLocalhostCorsOrigins} from '../browser/corsHeaders.ts'

describe('isLocalhostOrigin', (): void => {
    it('accepts http://localhost:<port>', (): void => {
        expect(isLocalhostOrigin('http://localhost:3000')).toBe(true)
        expect(isLocalhostOrigin('http://localhost:5173')).toBe(true)
        expect(isLocalhostOrigin('http://localhost:65535')).toBe(true)
    })

    it('accepts http://127.0.0.1:<port>', (): void => {
        expect(isLocalhostOrigin('http://127.0.0.1:3000')).toBe(true)
        expect(isLocalhostOrigin('http://127.0.0.1:8080')).toBe(true)
    })

    it('accepts http://[::1]:<port>', (): void => {
        expect(isLocalhostOrigin('http://[::1]:3000')).toBe(true)
    })

    it('rejects https origins', (): void => {
        expect(isLocalhostOrigin('https://localhost:3000')).toBe(false)
        expect(isLocalhostOrigin('https://127.0.0.1:3000')).toBe(false)
    })

    it('rejects remote hosts', (): void => {
        expect(isLocalhostOrigin('http://example.com:3000')).toBe(false)
        expect(isLocalhostOrigin('http://192.168.1.1:3000')).toBe(false)
        expect(isLocalhostOrigin('http://attacker.localhost:3000')).toBe(false)
    })

    it('rejects localhost without port', (): void => {
        expect(isLocalhostOrigin('http://localhost')).toBe(false)
    })

    it('rejects empty string', (): void => {
        expect(isLocalhostOrigin('')).toBe(false)
    })
})

describe('parseLocalhostCorsOrigins', (): void => {
    it('returns empty array for empty/blank string', (): void => {
        expect(parseLocalhostCorsOrigins('')).toEqual([])
        expect(parseLocalhostCorsOrigins('   ')).toEqual([])
    })

    it('parses valid localhost origins', (): void => {
        expect(parseLocalhostCorsOrigins('http://localhost:3000')).toEqual(['http://localhost:3000'])
        expect(
            parseLocalhostCorsOrigins('http://localhost:3000,http://127.0.0.1:3000'),
        ).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000'])
    })

    it('drops non-localhost origins and keeps valid ones', (): void => {
        const result = parseLocalhostCorsOrigins('http://localhost:3000,https://evil.com:3000,http://127.0.0.1:5173')
        expect(result).toEqual(['http://localhost:3000', 'http://127.0.0.1:5173'])
    })

    it('ignores blank entries from extra commas', (): void => {
        expect(parseLocalhostCorsOrigins('http://localhost:3000,,http://127.0.0.1:3000')).toEqual([
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ])
    })

    it('trims whitespace around origins', (): void => {
        expect(parseLocalhostCorsOrigins('  http://localhost:3000 , http://127.0.0.1:8080 ')).toEqual([
            'http://localhost:3000',
            'http://127.0.0.1:8080',
        ])
    })
})
