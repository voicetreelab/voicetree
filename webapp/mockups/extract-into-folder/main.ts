// Run: cd webapp && npx vite --config mockups/extract-into-folder/vite.config.ts
// Then open: http://localhost:5174/

import {
    showExtractIntoFolderPopup,
    type ExtractIntoFolderSelectedNode,
} from '@/shell/edge/UI-edge/graph/popups/extractIntoFolderPopup'

const selectedNodes: ExtractIntoFolderSelectedNode[] = [
    { id: 'n1', title: 'Architecture overview', parentFolderDisplay: '/tmp/project/notes/' },
    { id: 'n2', title: 'Auth flow diagram',     parentFolderDisplay: '/tmp/project/diagrams/' },
    { id: 'n3', title: 'Open questions',        parentFolderDisplay: '/tmp/project/' },
]
const commonAncestorDisplay = '/tmp/project/'
const defaultFolderName = 'extracted'

const resultBox = document.querySelector<HTMLDivElement>('#result')!
const reopenBtn = document.querySelector<HTMLButtonElement>('#reopen')!

async function openPopup(): Promise<void> {
    resultBox.style.display = 'none'
    const result = await showExtractIntoFolderPopup({
        selectedNodes,
        commonAncestorDisplay,
        defaultFolderName,
    })
    resultBox.style.display = 'block'
    if (result === null) {
        resultBox.classList.add('cancelled')
        resultBox.textContent = 'Cancelled'
    } else {
        resultBox.classList.remove('cancelled')
        resultBox.textContent = `folderName: ${JSON.stringify(result.folderName)}`
    }
}

reopenBtn.addEventListener('click', openPopup)
openPopup()
