import {describe, it, expect} from 'vitest'
import {lanCspHost, widenCspForLan} from './lanCsp'

describe('lanCspHost', () => {
    it('returns the host for a routable LAN VTD url', () => {
        expect(lanCspHost('http://192.168.0.98:56148')).toBe('192.168.0.98')
    })

    it('returns null for loopback hosts (policy stays unchanged)', () => {
        expect(lanCspHost('http://127.0.0.1:55345')).toBeNull()
        expect(lanCspHost('http://localhost:55345')).toBeNull()
        expect(lanCspHost('http://[::1]:55345')).toBeNull()
    })

    it('returns null when the url is absent or unparseable', () => {
        expect(lanCspHost(undefined)).toBeNull()
        expect(lanCspHost('')).toBeNull()
        expect(lanCspHost('not a url')).toBeNull()
    })
})

describe('widenCspForLan', () => {
    const csp =
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://x;\n" +
        'img-src http://127.0.0.1:*;'

    it('mirrors every loopback http/ws allowance onto the LAN host', () => {
        const out = widenCspForLan(csp, '192.168.0.98')
        expect(out).toContain('http://127.0.0.1:* http://192.168.0.98:*')
        expect(out).toContain('ws://127.0.0.1:* ws://192.168.0.98:*')
        // img-src loopback is widened too (same observable rule everywhere it appears).
        expect(out.match(/http:\/\/192\.168\.0\.98:\*/g)).toHaveLength(2)
    })

    it('does not touch localhost or non-loopback tokens', () => {
        const out = widenCspForLan(csp, '192.168.0.98')
        expect(out).toContain("'self' http://localhost:* http://127.0.0.1:*")
        expect(out).toContain('https://x')
    })
})
