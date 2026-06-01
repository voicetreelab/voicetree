import {describe, expect, it} from 'vitest'
import {argsShape} from './argsShape'

describe('argsShape — pure structural redaction of argv', () => {
    it('emits (none)-free output and just args when verb is (none)', () => {
        expect(argsShape({verb: '(none)', verbTokensInArgv: 0, argv: []})).toBe('')
    })

    it('redacts a single positional arg', () => {
        expect(argsShape({
            verb: 'search',
            verbTokensInArgv: 1,
            argv: ['search', 'ssh keys'],
        })).toBe('search <arg>')
    })

    it('redacts --flag=value to --flag=<redacted>', () => {
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', '--terminal=foo', '--from-stdin'],
        })).toBe('graph create --terminal=<redacted> --from-stdin')
    })

    it('treats space-separated flag value as a separate positional <arg>', () => {
        // We can't know which flags take values without a schema; the value
        // becomes a positional that gets redacted to <arg>.
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', '--terminal', 'foo'],
        })).toBe('graph create --terminal <arg>')
    })

    it('preserves bare boolean flags', () => {
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', '--from-stdin', '--json'],
        })).toBe('graph create --from-stdin --json')
    })

    it('handles global flags appearing before the verb tokens', () => {
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['--port=3002', 'graph', 'create', '--from-stdin'],
        })).toBe('graph create --port=<redacted> --from-stdin')
    })

    it('redacts trailing positional values after verb tokens', () => {
        // e.g. vt graph create work/topic.md
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', 'work/topic.md'],
        })).toBe('graph create <arg>')
    })

    it('emits (unknown) verb tokens silently (caller already chose not to prefix)', () => {
        expect(argsShape({
            verb: '(unknown)',
            verbTokensInArgv: 0,
            argv: ['something-weird', '--foo=bar'],
        })).toBe('<arg> --foo=<redacted>')
    })

    it('drops only the first N positionals matching verbTokensInArgv', () => {
        // If a verb consumes 1 positional ("project") and there are more
        // positionals after, those become <arg>.
        expect(argsShape({
            verb: 'project',
            verbTokensInArgv: 1,
            argv: ['project', 'show', '--project=/some/path'],
        })).toBe('project <arg> --project=<redacted>')
    })

    it('handles short flags as bare tokens', () => {
        expect(argsShape({
            verb: 'help',
            verbTokensInArgv: 0,
            argv: ['-h'],
        })).toBe('help -h')
    })

    it('preserves order of flags and positionals as they appear in argv', () => {
        expect(argsShape({
            verb: 'agent spawn',
            verbTokensInArgv: 2,
            argv: ['agent', 'spawn', 'task-foo', '--terminal=Ari', 'extra-arg', '--json'],
        })).toBe('agent spawn <arg> --terminal=<redacted> <arg> --json')
    })

    it('does not leak the equals-value even when value contains an equals sign', () => {
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', '--meta=key=value=more'],
        })).toBe('graph create --meta=<redacted>')
    })

    it('redacts a dash-prefixed positional value — does not treat it as a flag', () => {
        expect(argsShape({
            verb: 'search',
            verbTokensInArgv: 1,
            argv: ['search', '-secret-query'],
        })).toBe('search <arg>')
    })

    it('redacts negative numeric positionals after verb tokens', () => {
        expect(argsShape({
            verb: 'view layout set-pan',
            verbTokensInArgv: 3,
            argv: ['view', 'layout', 'set-pan', '-1', '2'],
        })).toBe('view layout set-pan <arg> <arg>')
    })

    it('emits -- literally and treats all post-double-dash tokens as positionals', () => {
        expect(argsShape({
            verb: 'graph create',
            verbTokensInArgv: 2,
            argv: ['graph', 'create', '--', '--literal-positional'],
        })).toBe('graph create -- <arg>')
    })
})
