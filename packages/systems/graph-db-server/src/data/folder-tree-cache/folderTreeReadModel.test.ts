/**
 * Black-box behavioural tests for the daemon folder-tree read model.
 *
 * The scanner is INJECTED — no vi.mock, no internal-dependency mocking. Each
 * test wires up a counting/deferred/throwing scanner closure and asserts on
 * the observable behaviour of the read model (return values + scanner
 * invocation counts captured by the closure).
 */

import { describe, test, expect } from 'vitest';
import { toAbsolutePath } from '@vt/graph-model/folders';
import type { AbsolutePath, DirectoryEntry } from '@vt/graph-model/folders';
import { createFolderTreeReadModel } from './folderTreeReadModel';
import type { FolderTreeScanner } from './types';

function makeEntry(absolutePath: AbsolutePath, name: string): DirectoryEntry {
    return {
        absolutePath,
        name,
        isDirectory: true,
        children: [],
    };
}

type Deferred<T> = {
    readonly promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolveFn: (value: T) => void = () => undefined;
    let rejectFn: (err: unknown) => void = () => undefined;
    const promise: Promise<T> = new Promise<T>((res, rej) => {
        resolveFn = res;
        rejectFn = rej;
    });
    return { promise, resolve: resolveFn, reject: rejectFn };
}

describe('folderTreeReadModel — cache hit reuse', () => {
    test('second read for same root returns cached value without re-invoking scanner', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath, _depth) => {
            calls += 1;
            if (calls > 1) throw new Error('scanner must not be invoked after cache hit');
            return makeEntry(rootPath, 'alpha');
        };

        const rm = createFolderTreeReadModel(scanner);

        const first: DirectoryEntry | null = await rm.readRootTree({ root });
        const second: DirectoryEntry | null = await rm.readRootTree({ root });

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first?.absolutePath).toBe(root);
        expect(second?.absolutePath).toBe(root);
        expect(calls).toBe(1);
    });
});

describe('folderTreeReadModel — invalidate({kind:"root"})', () => {
    test('next read after root invalidation triggers a fresh scan', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            calls += 1;
            return makeEntry(rootPath, 'alpha');
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readRootTree({ root });
        expect(calls).toBe(1);

        rm.invalidate({ kind: 'root', root });

        await rm.readRootTree({ root });
        expect(calls).toBe(2);
    });
});

describe('folderTreeReadModel — invalidate({kind:"pathChanged"})', () => {
    test('only the cached root containing the changed path is invalidated', async () => {
        const rootAlpha: AbsolutePath = toAbsolutePath('/project/alpha');
        const rootBeta: AbsolutePath = toAbsolutePath('/project/beta');

        let alphaCalls: number = 0;
        let betaCalls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            if (rootPath === rootAlpha) alphaCalls += 1;
            if (rootPath === rootBeta) betaCalls += 1;
            return makeEntry(rootPath, 'x');
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(alphaCalls).toBe(1);
        expect(betaCalls).toBe(1);

        // Path inside alpha should invalidate alpha only.
        rm.invalidate({
            kind: 'pathChanged',
            absolutePath: toAbsolutePath('/project/alpha/notes/today.md'),
        });

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(alphaCalls).toBe(2);
        expect(betaCalls).toBe(1);
    });

    test('path outside any cached root leaves all caches intact', async () => {
        const rootAlpha: AbsolutePath = toAbsolutePath('/project/alpha');
        const rootBeta: AbsolutePath = toAbsolutePath('/project/beta');

        let alphaCalls: number = 0;
        let betaCalls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            if (rootPath === rootAlpha) alphaCalls += 1;
            if (rootPath === rootBeta) betaCalls += 1;
            return makeEntry(rootPath, 'x');
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(alphaCalls).toBe(1);
        expect(betaCalls).toBe(1);

        rm.invalidate({
            kind: 'pathChanged',
            absolutePath: toAbsolutePath('/elsewhere/notes/today.md'),
        });

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(alphaCalls).toBe(1);
        expect(betaCalls).toBe(1);
    });

    test('pathChanged equal to the root invalidates that root', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            calls += 1;
            return makeEntry(rootPath, 'alpha');
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readRootTree({ root });
        rm.invalidate({ kind: 'pathChanged', absolutePath: root });
        await rm.readRootTree({ root });

        expect(calls).toBe(2);
    });

    test('sibling prefix is not falsely treated as descendant', async () => {
        // `/project/alpha-prime` must NOT be invalidated when `/project/alpha`
        // changes; naive `startsWith` without a trailing `/` guard would fail.
        const rootAlpha: AbsolutePath = toAbsolutePath('/project/alpha');
        const rootAlphaPrime: AbsolutePath = toAbsolutePath('/project/alpha-prime');

        let alphaCalls: number = 0;
        let primeCalls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            if (rootPath === rootAlpha) alphaCalls += 1;
            if (rootPath === rootAlphaPrime) primeCalls += 1;
            return makeEntry(rootPath, 'x');
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootAlphaPrime });

        // A change INSIDE alpha must not invalidate alpha-prime.
        rm.invalidate({
            kind: 'pathChanged',
            absolutePath: toAbsolutePath('/project/alpha/file.md'),
        });

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootAlphaPrime });

        expect(alphaCalls).toBe(2);
        expect(primeCalls).toBe(1);
    });
});

describe('folderTreeReadModel — invalidate({kind:"all"})', () => {
    test('clears every cached root', async () => {
        const rootAlpha: AbsolutePath = toAbsolutePath('/project/alpha');
        const rootBeta: AbsolutePath = toAbsolutePath('/project/beta');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath) => {
            calls += 1;
            return makeEntry(rootPath, 'x');
        };

        const rm = createFolderTreeReadModel(scanner);
        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(calls).toBe(2);

        rm.invalidate({ kind: 'all' });

        await rm.readRootTree({ root: rootAlpha });
        await rm.readRootTree({ root: rootBeta });
        expect(calls).toBe(4);
    });
});

describe('folderTreeReadModel — in-flight deduplication', () => {
    test('concurrent reads for same key invoke scanner exactly once', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const gate: Deferred<DirectoryEntry> = deferred<DirectoryEntry>();
        const scanner: FolderTreeScanner = async (rootPath) => {
            calls += 1;
            return gate.promise.then((entry: DirectoryEntry) => ({
                ...entry,
                absolutePath: rootPath,
            }));
        };

        const rm = createFolderTreeReadModel(scanner);

        const a: Promise<DirectoryEntry | null> = rm.readRootTree({ root });
        const b: Promise<DirectoryEntry | null> = rm.readRootTree({ root });
        const c: Promise<DirectoryEntry | null> = rm.readRootTree({ root });

        // Release the in-flight scanner exactly once.
        gate.resolve(makeEntry(root, 'alpha'));

        const [ra, rb, rc] = await Promise.all([a, b, c]);

        expect(calls).toBe(1);
        expect(ra?.absolutePath).toBe(root);
        expect(rb?.absolutePath).toBe(root);
        expect(rc?.absolutePath).toBe(root);
        // All three callers MUST observe the same resolved value object since
        // they share the same in-flight promise.
        expect(ra).toBe(rb);
        expect(rb).toBe(rc);
    });
});

describe('folderTreeReadModel — distinct maxDepth keys', () => {
    test('different maxDepth values are independent cache entries', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath, depth) => {
            calls += 1;
            return { ...makeEntry(rootPath, `alpha-d${depth}`) };
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readDepthLimitedTree({ root, maxDepth: 3 });
        await rm.readDepthLimitedTree({ root, maxDepth: 5 });
        expect(calls).toBe(2);

        // Re-reads at the same depths should hit cache.
        await rm.readDepthLimitedTree({ root, maxDepth: 3 });
        await rm.readDepthLimitedTree({ root, maxDepth: 5 });
        expect(calls).toBe(2);
    });

    test('root invalidation clears all depth variants for that root', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async (rootPath, depth) => {
            calls += 1;
            return makeEntry(rootPath, `alpha-d${depth}`);
        };

        const rm = createFolderTreeReadModel(scanner);

        await rm.readDepthLimitedTree({ root, maxDepth: 3 });
        await rm.readDepthLimitedTree({ root, maxDepth: 5 });
        expect(calls).toBe(2);

        rm.invalidate({ kind: 'root', root });

        await rm.readDepthLimitedTree({ root, maxDepth: 3 });
        await rm.readDepthLimitedTree({ root, maxDepth: 5 });
        expect(calls).toBe(4);
    });
});

describe('folderTreeReadModel — scanner exceptions', () => {
    test('exception propagates to caller and is NOT cached', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        let mode: 'throw' | 'ok' = 'throw';
        const scanner: FolderTreeScanner = async (rootPath) => {
            calls += 1;
            if (mode === 'throw') throw new Error('scan failed');
            return makeEntry(rootPath, 'alpha');
        };

        const rm = createFolderTreeReadModel(scanner);

        await expect(rm.readRootTree({ root })).rejects.toThrow('scan failed');
        expect(calls).toBe(1);

        // Failure not cached: next read retries.
        await expect(rm.readRootTree({ root })).rejects.toThrow('scan failed');
        expect(calls).toBe(2);

        // After switching to success, the read finally caches.
        mode = 'ok';
        const ok: DirectoryEntry | null = await rm.readRootTree({ root });
        expect(ok?.absolutePath).toBe(root);
        expect(calls).toBe(3);

        // Subsequent read served from cache.
        await rm.readRootTree({ root });
        expect(calls).toBe(3);
    });

    test('concurrent waiters all reject when the in-flight scan throws', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/alpha');
        let calls: number = 0;
        const gate: Deferred<DirectoryEntry> = deferred<DirectoryEntry>();
        const scanner: FolderTreeScanner = async () => {
            calls += 1;
            // All three waiters share this single rejection.
            return gate.promise;
        };

        const rm = createFolderTreeReadModel(scanner);

        const a = rm.readRootTree({ root });
        const b = rm.readRootTree({ root });
        const c = rm.readRootTree({ root });

        gate.reject(new Error('boom'));

        await expect(a).rejects.toThrow('boom');
        await expect(b).rejects.toThrow('boom');
        await expect(c).rejects.toThrow('boom');
        expect(calls).toBe(1);

        // After failure, in-flight cleared and next read retries.
        const okGate: Deferred<DirectoryEntry> = deferred<DirectoryEntry>();
        let nextCalls: number = 0;
        const rm2 = createFolderTreeReadModel(async (rootPath) => {
            nextCalls += 1;
            return okGate.promise.then(() => makeEntry(rootPath, 'alpha'));
        });
        const p = rm2.readRootTree({ root });
        okGate.resolve(makeEntry(root, 'alpha'));
        await p;
        expect(nextCalls).toBe(1);
    });
});

describe('folderTreeReadModel — null is a valid cached value', () => {
    test('scanner returning null caches that absence until invalidated', async () => {
        const root: AbsolutePath = toAbsolutePath('/project/ghost');
        let calls: number = 0;
        const scanner: FolderTreeScanner = async () => {
            calls += 1;
            return null;
        };

        const rm = createFolderTreeReadModel(scanner);

        expect(await rm.readRootTree({ root })).toBeNull();
        expect(await rm.readRootTree({ root })).toBeNull();
        expect(calls).toBe(1);

        rm.invalidate({ kind: 'root', root });

        expect(await rm.readRootTree({ root })).toBeNull();
        expect(calls).toBe(2);
    });
});
