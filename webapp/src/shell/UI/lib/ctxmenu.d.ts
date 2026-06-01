export interface ActionMenuItem {
    text?: string
    html?: string
    element?: HTMLElement
    action?: () => void | Promise<void>
    href?: string
    disabled?: boolean | (() => boolean)
    isDivider?: boolean
    subMenu?: ActionMenuItem[]
    subMenuAttributes?: Record<string, string>
}

interface CtxMenu {
    show(items: ActionMenuItem[], event: MouseEvent): void
    hide(): void
}

declare global {
    interface Window {
        ctxmenu: CtxMenu
    }
}

declare const ctxmenu: CtxMenu
export default ctxmenu
