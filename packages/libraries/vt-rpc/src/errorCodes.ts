// JSON-RPC error codes for the VoiceTree daemon wire. Authoritative copy lives
// in design doc §4.6. CLI-layer translations (-32000, -32004) are
// synthesized client-side from transport conditions, never emitted by the
// daemon directly.

export const ERROR_CODES = {
    parse_error: -32700,
    invalid_request: -32600,
    tool_not_found: -32601,
    validation_failed: -32602,
    internal_error: -32603,
    daemon_unreachable: -32000,
    renderer_required: -32001,
    caller_terminal_unknown: -32002,
    tool_handler_failed: -32003,
    auth_required: -32004,
} as const

export type ErrorKindAlias =
    | 'parse_error'
    | 'invalid_request'
    | 'tool_not_found'
    | 'validation_failed'
    | 'internal_error'
    | 'daemon_unreachable'
    | 'renderer_required'
    | 'caller_terminal_unknown'
    | 'tool_handler_failed'
    | 'auth_required'

export type ErrorCode = typeof ERROR_CODES[ErrorKindAlias]
