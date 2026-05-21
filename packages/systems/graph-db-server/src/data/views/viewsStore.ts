import type { FolderVisibilityDatabase } from './folderVisibilitySqlite'
import {
    type CreatedView,
    type ViewRecord,
    cloneView as cloneViewInRepository,
    createView as createViewInRepository,
    deleteView as deleteViewInRepository,
    ensureDefaultView as ensureDefaultViewInRepository,
    getActiveViewId as getActiveViewIdInRepository,
    listViews as listViewsInRepository,
    switchActiveView as switchActiveViewInRepository,
} from './viewsRepository'

export type ViewSwitchedEvent = {
    readonly type: 'view-switched'
    readonly previousViewId: string
    readonly activeViewId: string
}

export type ViewSwitchedListener = (event: ViewSwitchedEvent) => void

export type ViewsStore = {
    listViews(): readonly ViewRecord[]
    createView(name: string): CreatedView
    switchActiveView(targetViewId: string): void
    cloneView(srcViewId: string, dstName: string): CreatedView
    deleteView(viewId: string): void
    getActiveViewId(): string
    ensureDefaultView(): void
    on(event: 'view-switched', listener: ViewSwitchedListener): () => void
}

const viewSwitchedListeners = new Set<ViewSwitchedListener>()

export function onViewSwitched(listener: ViewSwitchedListener): () => void {
    viewSwitchedListeners.add(listener)
    return (): void => {
        viewSwitchedListeners.delete(listener)
    }
}

export function emitViewSwitched(event: ViewSwitchedEvent): void {
    for (const listener of viewSwitchedListeners) {
        listener(event)
    }
}

export function createViewsStore(db: FolderVisibilityDatabase): ViewsStore {
    return {
        listViews: () => listViewsInRepository(db),
        createView: (name: string) => createViewInRepository(db, name),
        switchActiveView: (targetViewId: string): void => {
            const previousViewId = getActiveViewIdInRepository(db)
            switchActiveViewInRepository(db, targetViewId)
            const activeViewId = getActiveViewIdInRepository(db)
            if (previousViewId !== activeViewId) {
                emitViewSwitched({
                    type: 'view-switched',
                    previousViewId,
                    activeViewId,
                })
            }
        },
        cloneView: (srcViewId: string, dstName: string) => cloneViewInRepository(db, srcViewId, dstName),
        deleteView: (viewId: string) => deleteViewInRepository(db, viewId),
        getActiveViewId: () => getActiveViewIdInRepository(db),
        ensureDefaultView: () => ensureDefaultViewInRepository(db),
        on: (_event: 'view-switched', listener: ViewSwitchedListener) => onViewSwitched(listener),
    }
}
