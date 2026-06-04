import {escapeHtml, escapeHtmlAttr} from '@/utils/escapeHtml'

export interface ExtractIntoFolderSelectedNode {
    readonly id: string
    readonly title: string
    readonly parentFolderDisplay: string
}

export interface ExtractIntoFolderPopupInput {
    readonly selectedNodes: readonly ExtractIntoFolderSelectedNode[]
    readonly commonAncestorDisplay: string
    readonly defaultFolderName: string
}

export interface ExtractIntoFolderPopupResult {
    readonly folderName: string
}

export function showExtractIntoFolderPopup(
    input: ExtractIntoFolderPopupInput
): Promise<ExtractIntoFolderPopupResult | null> {
    return new Promise((resolve: (value: ExtractIntoFolderPopupResult | null) => void) => {
        const dialog: HTMLDialogElement = document.createElement('dialog')
        dialog.id = 'extract-into-folder-dialog'
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 560px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            margin: 0;
        `

        const nodeCount: number = input.selectedNodes.length
        const nodeRowsHtml: string = input.selectedNodes
            .map((node: ExtractIntoFolderSelectedNode) => `
                <li style="margin: 6px 0; font-size: 0.85rem; display: flex; gap: 8px; align-items: baseline;">
                    <span style="font-weight: 500;">${escapeHtml(node.title)}</span>
                    <span style="color: var(--muted-foreground); font-size: 0.78rem;">${escapeHtml(node.parentFolderDisplay)}</span>
                </li>`)
            .join('')

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Extract ${nodeCount} Node${nodeCount !== 1 ? 's' : ''} Into Folder
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    Selected nodes live in different folders. They will be moved out of their current folders into a new subfolder placed at their closest common ancestor.
                </p>
                <div style="
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: calc(var(--radius) - 2px);
                    background: var(--muted);
                    max-height: 160px;
                    overflow-y: auto;
                ">
                    <span style="font-size: 0.8rem; color: var(--muted-foreground); display: block; margin-bottom: 6px;">
                        Selected nodes (and their current folders):
                    </span>
                    <ul data-testid="extract-selected-nodes-list" style="margin: 0; padding-left: 20px; list-style-type: disc;">
                        ${nodeRowsHtml}
                    </ul>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem;">
                    <span style="color: var(--muted-foreground);">Closest common ancestor:</span>
                    <code data-testid="extract-common-ancestor" style="
                        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                        background: var(--muted);
                        padding: 6px 8px;
                        border-radius: calc(var(--radius) - 4px);
                        word-break: break-all;
                    ">${escapeHtml(input.commonAncestorDisplay)}</code>
                </div>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">New folder name</span>
                    <input
                        type="text"
                        id="extract-folder-name-input"
                        data-testid="extract-folder-name-input"
                        value="${escapeHtmlAttr(input.defaultFolderName)}"
                        style="
                            width: 100%;
                            padding: 10px 12px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--input);
                            color: var(--foreground);
                            font-family: inherit;
                            font-size: 0.9rem;
                            box-sizing: border-box;
                        "
                    />
                </label>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: var(--muted-foreground);">
                    <span>Final location:</span>
                    <code data-testid="extract-final-location" style="
                        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                        background: var(--muted);
                        padding: 6px 8px;
                        border-radius: calc(var(--radius) - 4px);
                        word-break: break-all;
                    ">${escapeHtml(joinForDisplay(input.commonAncestorDisplay, input.defaultFolderName))}</code>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button
                        type="button"
                        id="extract-cancel-button"
                        data-testid="extract-cancel-button"
                        style="
                            padding: 8px 16px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: transparent;
                            color: var(--foreground);
                            cursor: pointer;
                            font-size: 0.9rem;
                        "
                    >Cancel</button>
                    <button
                        type="submit"
                        id="extract-confirm-button"
                        data-testid="extract-confirm-button"
                        style="
                            padding: 8px 16px;
                            border: none;
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--primary);
                            color: var(--primary-foreground);
                            cursor: pointer;
                            font-size: 0.9rem;
                        "
                    >Extract</button>
                </div>
            </form>
        `

        document.body.appendChild(dialog)

        const form: HTMLFormElement = dialog.querySelector('form')!
        const nameInput: HTMLInputElement = dialog.querySelector('#extract-folder-name-input')!
        const confirmButton: HTMLButtonElement = dialog.querySelector('#extract-confirm-button')!
        const cancelButton: HTMLButtonElement = dialog.querySelector('#extract-cancel-button')!
        const finalLocation: HTMLElement = dialog.querySelector('[data-testid="extract-final-location"]')!

        const updateConfirmEnabled = (): void => {
            const hasContent: boolean = nameInput.value.trim().length > 0
            confirmButton.disabled = !hasContent
            confirmButton.style.opacity = hasContent ? '1' : '0.5'
            confirmButton.style.cursor = hasContent ? 'pointer' : 'not-allowed'
        }

        const updateFinalLocation = (): void => {
            finalLocation.textContent = joinForDisplay(input.commonAncestorDisplay, nameInput.value)
        }

        nameInput.addEventListener('input', () => {
            updateConfirmEnabled()
            updateFinalLocation()
        })

        cancelButton.addEventListener('click', () => {
            dialog.close()
            resolve(null)
        })

        form.addEventListener('submit', (event: Event) => {
            event.preventDefault()
            const folderName: string = nameInput.value.trim()
            dialog.close()
            if (folderName.length === 0) {
                resolve(null)
                return
            }
            resolve({ folderName })
        })

        dialog.addEventListener('close', () => {
            dialog.remove()
        })

        dialog.addEventListener('cancel', (event: Event) => {
            event.preventDefault()
        })

        updateConfirmEnabled()
        updateFinalLocation()
        dialog.showModal()
        nameInput.focus()
        nameInput.select()
    })
}

function joinForDisplay(ancestorDisplay: string, folderName: string): string {
    const trimmedName: string = folderName.trim()
    if (trimmedName.length === 0) {
        return ancestorDisplay
    }
    if (ancestorDisplay === '(root)' || ancestorDisplay === '/') {
        return `/${trimmedName}/`
    }
    const withTrailingSlash: string = ancestorDisplay.endsWith('/') ? ancestorDisplay : `${ancestorDisplay}/`
    return `${withTrailingSlash}${trimmedName}/`
}
