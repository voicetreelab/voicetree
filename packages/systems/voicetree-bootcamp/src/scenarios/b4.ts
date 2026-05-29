/**
 * B4 — semantic index + search + focus + unseen.
 *
 * 20-note vault, 4 clusters. Agent indexes, searches "authentication flow",
 * focuses the top hit, surfaces unseen related nodes. The plan's stdout-based
 * verification ("auth-jwt-flow.md in the first 3 result lines") is currently
 * unrunnable — the PATH shim only captures stderr/exit code, not stdout.
 * Until the shim is widened, successCriteria asserts on filesystem artefacts
 * (index dir non-empty) + shim-log argv shape (search query targets
 * "authentication flow", focus targets auth-jwt-flow.md), and trusts the
 * agent's transcript for top-3 verification at the harness level.
 */
import {promises as fs} from 'node:fs'
import * as path from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {ScenarioSpec, SuccessResult} from '../types.ts'
import {matchesVerb} from '../shim-log.ts'
import {fileExists, loadShimLog, writeFile} from './_helpers.ts'

const TASK_PROMPT = `This vault has about 20 notes across several topics. Build a semantic index
over the vault, then search it for the query "authentication flow". Open the
top match, view its 2-hop neighborhood, and list any related notes you
haven't read yet in this session.

Report the top three search hits, the names of the neighbors you saw on
focus, and the unseen-but-related nodes. Use \`vt --help\` to discover the
right subcommands.`

const AUTH_NOTES = [
    {
        name: 'auth-jwt-flow.md',
        body: [
            '# JWT authentication flow',
            '',
            'The authentication flow for JWT-based sessions starts at the login endpoint.',
            'A signed token is returned to the client and replayed on every request.',
            'Token expiry is enforced server-side; the refresh handshake is documented in auth-session-refresh.',
            'When a request arrives without a valid token, the auth middleware short-circuits with 401.',
            'Edge case: clock skew between issuer and verifier breaks expiry comparisons silently.',
            'See also: the OAuth handoff path in auth-oauth-handoff for third-party flows.',
        ].join('\n'),
    },
    {
        name: 'auth-oauth-handoff.md',
        body: [
            '# OAuth handoff',
            '',
            'OAuth flow piggy-backs on the same authentication flow, but the token is minted by the IdP.',
            'On callback, we exchange the code for an id_token plus access_token and persist a server session.',
            'Subsequent requests use the same JWT verifier as auth-jwt-flow; the IdP cert chain is the only delta.',
            'Refresh follows auth-session-refresh once the session cookie is set.',
        ].join('\n'),
    },
    {
        name: 'auth-session-refresh.md',
        body: [
            '# Session refresh',
            '',
            'The session refresh path closes the loop on the authentication flow.',
            'When the access token expires, the client posts the refresh token to /auth/refresh.',
            'A new access token (and a rotated refresh token) is returned; the previous refresh token is revoked.',
            'Failure modes: replay of a revoked refresh, family-rotation collisions, and clock skew.',
            'Reuses verifier from auth-jwt-flow; not relevant to OAuth third-party flows in auth-oauth-handoff.',
        ].join('\n'),
    },
] as const

const STORAGE_NOTES = [
    {name: 'db-schema.md', body: '# DB schema\n\nNormalized schema covering users, sessions, posts, audit log.\n'},
    {name: 'db-migrations.md', body: '# DB migrations\n\nForward-only Atlas migrations; rollback via snapshot.\n'},
    {name: 'blob-storage.md', body: '# Blob storage\n\nS3-compatible buckets per tenant; SSE-KMS at rest.\n'},
    {name: 'cache-policy.md', body: '# Cache policy\n\nLRU at edge, TTL=60s default; manual invalidation hook.\n'},
] as const

const RENDERING_NOTES = [
    {name: 'ui-virtualscroll.md', body: '# Virtual scroll\n\nWindowed list rendering for the inbox view.\n'},
    {name: 'ui-theme.md', body: '# UI theme\n\nLight/dark + high-contrast variants via CSS variables.\n'},
    {name: 'ui-keyboard.md', body: '# Keyboard\n\nGlobal shortcut bus; chord support via prefix table.\n'},
    {name: 'ui-canvas.md', body: '# Canvas\n\nNode-graph canvas; uses WebGL where supported.\n'},
] as const

const INFRA_NOTES = [
    {name: 'deploy.md', body: '# Deploy\n\nKubernetes via Argo CD; per-tenant namespaces.\n'},
    {name: 'ci.md', body: '# CI\n\nGitHub Actions; matrix over node 20/22.\n'},
    {name: 'secrets.md', body: '# Secrets\n\nVault per-environment; injected at pod boot.\n'},
    {name: 'observability.md', body: '# Observability\n\nOpenTelemetry → Tempo + Loki.\n'},
    {name: 'rate-limit.md', body: '# Rate limit\n\nToken bucket per API key; sliding window.\n'},
    {name: 'backup.md', body: '# Backup\n\nNightly snapshots; 30 day retention.\n'},
] as const

const META_NOTES = [
    {name: 'roadmap.md', body: '# Roadmap\n\nQ1 reliability; Q2 mobile; Q3 collaboration; Q4 enterprise.\n'},
    {name: 'glossary.md', body: '# Glossary\n\nDomain terms: tenant, session, node, edge, view.\n'},
    {
        name: 'postmortem-2024-q3.md',
        body: '# Postmortem 2024 Q3\n\nDB failover took 9 minutes; root cause was stale replica state.\n',
    },
] as const

const SEEN_NODES = ['auth-jwt-flow.md', 'auth-oauth-handoff.md', 'db-schema.md', 'db-migrations.md'] as const

export const b4: ScenarioSpec = {
    id: 'B4',
    name: 'semantic index + search + focus + unseen',
    async setup(vaultDir) {
        const allNotes = [...AUTH_NOTES, ...STORAGE_NOTES, ...RENDERING_NOTES, ...INFRA_NOTES, ...META_NOTES]
        for (const {name, body} of allNotes) {
            await writeFile(path.join(vaultDir, name), body.endsWith('\n') ? body : body + '\n')
        }
        const dotVoicetreePath = getProjectDotVoicetreePath(vaultDir)
        await writeFile(
            path.join(dotVoicetreePath, 'links.json'),
            JSON.stringify({
                edges: [
                    {parent: 'db-schema.md', child: 'db-migrations.md'},
                    {parent: 'ui-virtualscroll.md', child: 'ui-canvas.md'},
                    {parent: 'deploy.md', child: 'ci.md'},
                    {parent: 'observability.md', child: 'rate-limit.md'},
                ],
            }),
        )
        await writeFile(
            path.join(dotVoicetreePath, 'session.json'),
            JSON.stringify({
                sessions: {default: {seen: SEEN_NODES}},
                active: 'default',
            }),
        )
    },
    taskPrompt: TASK_PROMPT,
    expectedCommands: [
        {verb: 'graph index'},
        {verb: 'graph search'},
        {verb: 'graph live focus'},
        {verb: 'graph unseen'},
    ],
    async successCriteria(vaultDir): Promise<SuccessResult> {
        const indexDir = path.join(getProjectDotVoicetreePath(vaultDir), 'index')
        if (!(await fileExists(indexDir))) {
            return {passed: false, detail: '.voicetree/index/ missing — agent did not run graph index'}
        }
        if (!(await directoryNonEmpty(indexDir))) {
            return {passed: false, detail: '.voicetree/index/ exists but contains no artefacts'}
        }

        const shimLog = await loadShimLog(vaultDir)

        const searchHit = shimLog.find(
            (e) =>
                (matchesVerb(e, 'graph search') || matchesVerb(e, 'search')) &&
                e.exitCode === 0 &&
                e.argv.join(' ').toLowerCase().includes('authentication flow'),
        )
        if (searchHit === undefined) {
            return {
                passed: false,
                detail: 'no successful graph search invocation carried the "authentication flow" query',
            }
        }

        const focusHit = shimLog.find(
            (e) =>
                matchesVerb(e, 'graph live focus') &&
                e.exitCode === 0 &&
                e.argv.some((a) => a.includes('auth-jwt-flow')),
        )
        if (focusHit === undefined) {
            return {
                passed: false,
                detail: 'no successful graph live focus invocation targeted auth-jwt-flow.md',
            }
        }

        const unseenHit = shimLog.find((e) => matchesVerb(e, 'graph unseen') && e.exitCode === 0)
        if (unseenHit === undefined) {
            return {passed: false, detail: 'no successful graph unseen invocation present in shim log'}
        }

        return {
            passed: true,
            detail: 'index built; search/focus/unseen each fired with the expected argv shape',
        }
    },
    budgets: {
        tokens: 5000,
        toolCalls: 6,
        vtInvocations: 6,
        seconds: 30,
    },
}

async function directoryNonEmpty(dir: string): Promise<boolean> {
    try {
        const entries = await fs.readdir(dir)
        for (const name of entries) {
            const stat = await fs.stat(path.join(dir, name))
            if (stat.isFile() && stat.size > 0) return true
            if (stat.isDirectory()) {
                if (await directoryNonEmpty(path.join(dir, name))) return true
            }
        }
        return false
    } catch {
        return false
    }
}
