import {describe, expect, it} from 'vitest'
import {isLocalhostOrigin, isPrivateLanHttpOrigin, parseDevCorsOrigins} from '../browser/corsHeaders.ts'

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

describe('isPrivateLanHttpOrigin', (): void => {
    it('accepts RFC1918 private-range IPv4 origins with a port', (): void => {
        expect(isPrivateLanHttpOrigin('http://192.168.1.20:3000')).toBe(true)
        expect(isPrivateLanHttpOrigin('http://10.0.0.5:5173')).toBe(true)
        expect(isPrivateLanHttpOrigin('http://172.16.0.9:3000')).toBe(true)
        expect(isPrivateLanHttpOrigin('http://172.31.255.255:8080')).toBe(true)
    })

    it('rejects public IPv4, out-of-range 172.x, https, and missing port', (): void => {
        expect(isPrivateLanHttpOrigin('http://8.8.8.8:3000')).toBe(false)
        expect(isPrivateLanHttpOrigin('http://172.32.0.1:3000')).toBe(false)
        expect(isPrivateLanHttpOrigin('http://172.15.0.1:3000')).toBe(false)
        expect(isPrivateLanHttpOrigin('https://192.168.1.20:3000')).toBe(false)
        expect(isPrivateLanHttpOrigin('http://192.168.1.20')).toBe(false)
    })
})

describe('parseDevCorsOrigins', (): void => {
    it('returns empty array for empty/blank string', (): void => {
        expect(parseDevCorsOrigins('')).toEqual([])
        expect(parseDevCorsOrigins('   ')).toEqual([])
    })

    it('parses valid localhost origins', (): void => {
        expect(parseDevCorsOrigins('http://localhost:3000')).toEqual(['http://localhost:3000'])
        expect(
            parseDevCorsOrigins('http://localhost:3000,http://127.0.0.1:3000'),
        ).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000'])
    })

    it('parses private-LAN origins alongside localhost (LAN mode)', (): void => {
        expect(
            parseDevCorsOrigins('http://localhost:3000,http://192.168.1.20:3000'),
        ).toEqual(['http://localhost:3000', 'http://192.168.1.20:3000'])
    })

    it('drops public/https origins and keeps valid loopback + LAN ones', (): void => {
        const result = parseDevCorsOrigins(
            'http://localhost:3000,https://evil.com:3000,http://8.8.8.8:3000,http://10.0.0.5:5173',
        )
        expect(result).toEqual(['http://localhost:3000', 'http://10.0.0.5:5173'])
    })

    it('ignores blank entries from extra commas', (): void => {
        expect(parseDevCorsOrigins('http://localhost:3000,,http://127.0.0.1:3000')).toEqual([
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ])
    })

    it('trims whitespace around origins', (): void => {
        expect(parseDevCorsOrigins('  http://localhost:3000 , http://127.0.0.1:8080 ')).toEqual([
            'http://localhost:3000',
            'http://127.0.0.1:8080',
        ])
    })
})
