/**
 * Server-side protocol contract.
 *
 * The single re-export from `@vt/graph-db-protocol` makes all shared
 * cross-process schemas and types available under the server package's
 * `@vt/graph-db-server/contract` subpath. Server-internal modules import
 * from here instead of reaching for the protocol package directly, so the
 * server keeps exactly one cross-package edge to protocol for its entire
 * public-protocol surface.
 *
 * Historically this file had a duplicate `OpenProjectRequest/Response`
 * declaration that diverged from the protocol package's version. The
 * canonical definition lives in `@vt/graph-db-protocol`; the duplicate
 * has been removed.
 */

export * from '@vt/graph-db-protocol'
