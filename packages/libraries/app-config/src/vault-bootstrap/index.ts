/**
 * Vault-bootstrap filesystem helpers: side effects that run once when
 * VoiceTree opens a vault, before the daemon claims it.
 *
 * Both helpers are pure file-system writes with no daemon-runtime state —
 * they live in `@vt/app-config` because that is the package that already
 * owns vault-config / settings / project-init filesystem layout.
 *
 *   - `stripStaleVoicetreeMcpEntries`: scrubs legacy `voicetree` MCP-server
 *     entries from external coding-agent config files in the vault + its
 *     ancestor chain.
 *   - `writeVaultAgentDiscoveryFile`: advertises the `vt` CLI to user-
 *     launched coding agents via CLAUDE.md / .voicetree/AGENTS.md.
 *
 * Both lived in `@vt/vt-daemon`'s config/ until 2026-05-27; moving them to
 * `@vt/app-config` removes the webapp → vt-daemon production edge that
 * was carried by their import path (they had no daemon-internal callers).
 */

export {stripStaleVoicetreeMcpEntries} from './mcp-client-config'
export {
    buildVoicetreeDiscoverySection,
    spliceVoicetreeDiscoverySection,
    writeVaultAgentDiscoveryFile,
} from './vaultAgentDiscoveryFile'
