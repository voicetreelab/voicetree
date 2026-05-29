/**
 * Inter-agent message wrapper format.
 *
 * `vt agent send` does not deliver the raw user-typed text to the target
 * terminal. The daemon wraps it as:
 *
 *     [From: <callerTerminalId>] <message>
 *
 *     If you need to reply use the cli tool 'vt agent send' to <callerTerminalId>. ...
 *
 * The wrapper is what makes inter-agent conversation work: the receiver's
 * reply (`vt agent send <callerTerminalId> ...`) lands in the original
 * sender's terminal with the same prefix, so neither side needs to poll
 * `vt agent output`.
 *
 * This file is the single source for that format. The daemon imports
 * `buildFromPrefixedMessage` for the runtime wrap; the user-facing manual
 * (in @vt/vt-daemon-protocol's tool-specs) renders the same function with
 * placeholder identifiers so the documented format cannot drift from
 * what the daemon actually emits.
 */

export const FROM_PREFIX_REPLY_TOOL_INSTRUCTION: string =
    "(DO NOT USE SendMessage or other messaging tools you may have, they won't work)"

export function buildFromPrefixedMessage(callerTerminalId: string, message: string): string {
    return `[From: ${callerTerminalId}] ${message}\n\nIf you need to reply use the cli tool 'vt agent send' to ${callerTerminalId}. ${FROM_PREFIX_REPLY_TOOL_INSTRUCTION}`
}
