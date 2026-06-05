/**
 * Package root is intentionally narrow.
 *
 * Daemon consumers import explicit package subpaths such as
 * `@vt/vt-daemon/transport/httpServer` or
 * `@vt/vt-daemon/agent-runtime/agent-control/tools/listAgentsTool`.
 * That keeps the package boundary honest: a change in one daemon subsystem
 * does not route through a god-barrel that couples every sibling directory.
 */
