/**
 * Integration test for spawnTerminalWithNewContextNode
 *
 * BEHAVIOR TESTED:
 * - INPUT: A parent node ID and Cytoscape instance
 * - OUTPUT:
 *   - Main process is called with correct parameters
 *   - Terminal count is computed correctly from UI state
 *
 * NEW ARCHITECTURE (main-driven):
 * 1. UI calls main.spawnTerminalWithContextNode(parentNodeId, command, terminalCount)
 * 2. Main creates context node, prepares terminal data
 * 3. Main calls uiAPI.launchTerminalOntoUI(contextNodeId, terminalData)
 * 4. UI renders terminal
 *
 * These tests verify the UI-side behavior:
 * - Correct terminal count computation
 * - Correct delegation to main process
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearTerminals, addTerminal } from '@/shell/edge/UI-edge/state/TerminalStore'
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/types'
import type { NodeIdAndFilePath } from '@/pure/graph'
import type { VTSettings } from '@/pure/settings'
import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

// Define the result type inline since we can't import it (would trigger ctxmenu.js)
interface AgentCommandEditorResult {
    command: string;
    agentPrompt: string;
    mcpIntegrationEnabled: boolean;
    useDocker: boolean;
}

// Mock ctxmenu.js which has ES Module compatibility issues in test environment
vi.mock('@/shell/UI/lib/ctxmenu.js', () => ({
    default: { ctxmenu: { attach: vi.fn(), update: vi.fn(), delete: vi.fn() } },
    ctxmenu: { attach: vi.fn(), update: vi.fn(), delete: vi.fn() }
}))

// Mock modules that transitively import ctxmenu.js to avoid loading issues
vi.mock('@/shell/edge/UI-edge/graph/agentCommandEditorPopup', () => ({
    showAgentCommandEditor: vi.fn(),
    AUTO_RUN_FLAG: '--dangerously-skip-permissions'
}))

// Mock flushEditorForNode to avoid CodeMirrorEditorView -> ctxmenu.js chain
vi.mock('@/shell/edge/UI-edge/floating-windows/editors/flushEditorForNode', () => ({
    flushEditorForNode: vi.fn().mockResolvedValue(undefined)
}))

// Import the mocked module to get access to the mock function
import { showAgentCommandEditor } from '@/shell/edge/UI-edge/graph/agentCommandEditorPopup'
import type { Mock } from 'vitest'
const mockShowAgentCommandEditor: Mock = vi.mocked(showAgentCommandEditor)

// Import after mocks are set up
import { spawnTerminalWithNewContextNode, spawnTerminalWithCommandEditor } from '@/shell/edge/UI-edge/floating-windows/terminals/spawnTerminalWithCommandFromUI'

describe('spawnTerminalWithNewContextNode - Integration Tests', () => {
    let cy: Core
    let mockSpawnTerminalWithContextNode: ReturnType<typeof vi.fn>
    let mockLoadSettings: ReturnType<typeof vi.fn>
    let mockSaveSettings: ReturnType<typeof vi.fn>

    // Default settings with permission mode already chosen (skips popup)
    const defaultSettings: VTSettings = {
        agents: [{ name: 'Claude', command: 'claude' }],
        agentPermissionModeChosen: true,
        INJECT_ENV_VARS: {},
        terminalSpawnPathRelativeToWatchedDirectory: '',
        shiftEnterSendsOptionEnter: false,
        contextNodeMaxDistance: 2,
        askModeContextDistance: 1,
    } as unknown as VTSettings

    beforeEach(() => {
        // Create a minimal Cytoscape instance for testing
        cy = cytoscape({
            headless: true,
            elements: []
        })

        // Mock window.electronAPI.main functions
        mockSpawnTerminalWithContextNode = vi.fn().mockResolvedValue(undefined)
        mockLoadSettings = vi.fn().mockResolvedValue(defaultSettings)
        mockSaveSettings = vi.fn().mockResolvedValue(undefined)

        global.window = {
            electronAPI: {
                main: {
                    spawnTerminalWithContextNode: mockSpawnTerminalWithContextNode,
                    loadSettings: mockLoadSettings,
                    saveSettings: mockSaveSettings,
                    setMcpIntegration: vi.fn().mockResolvedValue(undefined),
                }
            }
        } as unknown as Window & typeof globalThis

        // Clear terminal state
        clearTerminals()
    })

    afterEach(() => {
        cy.destroy()
        clearTerminals()
        vi.restoreAllMocks()
    })

    describe('BEHAVIOR: Delegate to main process with correct parameters', () => {
        it('should call main.spawnTerminalWithContextNode with parentNodeId and terminalCount 0 for new node', async () => {
            // GIVEN: A parent node ID with no existing terminals
            const parentNodeId: NodeIdAndFilePath = 'test-node.md'

            // WHEN: Spawn terminal with new context node
            await spawnTerminalWithNewContextNode(parentNodeId, cy)

            // THEN: Should call main process with correct parameters
            // Note: command is now resolved from settings in renderer when not specified
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledTimes(1)
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledWith(
                parentNodeId,
                'claude', // default command from settings
                0, // terminal count starts at 0
                undefined, undefined, undefined, undefined // skipFitAnimation, startUnpinned, selectedNodeIds, spawnDirectory
            )
        })

        it('should pass agent command to main process when specified', async () => {
            // GIVEN: A parent node ID and specific agent command
            const parentNodeId: NodeIdAndFilePath = 'test-node.md'
            const agentCommand: string = 'custom-agent --flag'

            // WHEN: Spawn terminal with specific agent command
            await spawnTerminalWithNewContextNode(parentNodeId, cy, agentCommand)

            // THEN: Should pass agent command to main
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledWith(
                parentNodeId,
                agentCommand,
                0,
                undefined, undefined, undefined, undefined // skipFitAnimation, startUnpinned, selectedNodeIds, spawnDirectory
            )
        })

        it('should compute correct terminal count when terminals already exist for node', async () => {
            // GIVEN: A parent node ID with existing terminals
            const parentNodeId: NodeIdAndFilePath = 'test-node.md'

            // Add existing terminals for this node
            const existingTerminal1: TerminalData = createTerminalData({
                attachedToNodeId: parentNodeId,
                terminalCount: 0,
                title: 'Terminal 0',
                anchoredToNodeId: parentNodeId,
                initialCommand: 'cmd1',
                executeCommand: false,
            })
            const existingTerminal2: TerminalData = createTerminalData({
                attachedToNodeId: parentNodeId,
                terminalCount: 1,
                title: 'Terminal 1',
                anchoredToNodeId: parentNodeId,
                initialCommand: 'cmd2',
                executeCommand: false,
            })
            addTerminal(existingTerminal1)
            addTerminal(existingTerminal2)

            // WHEN: Spawn another terminal for the same node
            await spawnTerminalWithNewContextNode(parentNodeId, cy)

            // THEN: Should pass terminal count = 2 (next after 0, 1)
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledWith(
                parentNodeId,
                'claude', // default command from settings
                2,
                undefined, undefined, undefined, undefined // skipFitAnimation, startUnpinned, selectedNodeIds, spawnDirectory
            )
        })

        it('should compute terminal count correctly with gaps in numbering', async () => {
            // GIVEN: Terminals with counts 0 and 3 (gap at 1, 2)
            const parentNodeId: NodeIdAndFilePath = 'test-node.md'

            const terminal0: TerminalData = createTerminalData({
                attachedToNodeId: parentNodeId,
                terminalCount: 0,
                title: 'Terminal 0',
                anchoredToNodeId: parentNodeId,
                initialCommand: 'cmd',
                executeCommand: false,
            })
            const terminal3: TerminalData = createTerminalData({
                attachedToNodeId: parentNodeId,
                terminalCount: 3,
                title: 'Terminal 3',
                anchoredToNodeId: parentNodeId,
                initialCommand: 'cmd',
                executeCommand: false,
            })
            addTerminal(terminal0)
            addTerminal(terminal3)

            // WHEN: Spawn another terminal
            await spawnTerminalWithNewContextNode(parentNodeId, cy)

            // THEN: Should use max + 1 = 4 (not fill gaps)
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledWith(
                parentNodeId,
                'claude', // default command from settings
                4,
                undefined, undefined, undefined, undefined // skipFitAnimation, startUnpinned, selectedNodeIds, spawnDirectory
            )
        })

        it('should not count terminals from other nodes', async () => {
            // GIVEN: Terminals attached to different nodes
            const parentNodeId: NodeIdAndFilePath = 'test-node.md'
            const otherNodeId: NodeIdAndFilePath = 'other-node.md'

            const terminalForOtherNode: TerminalData = createTerminalData({
                attachedToNodeId: otherNodeId,
                terminalCount: 5,
                title: 'Terminal for other',
                anchoredToNodeId: otherNodeId,
                initialCommand: 'cmd',
                executeCommand: false,
            })
            addTerminal(terminalForOtherNode)

            // WHEN: Spawn terminal for our node
            await spawnTerminalWithNewContextNode(parentNodeId, cy)

            // THEN: Should start at 0 (other node's terminals don't count)
            expect(mockSpawnTerminalWithContextNode).toHaveBeenCalledWith(
                parentNodeId,
                'claude', // default command from settings
                0,
                undefined, undefined, undefined, undefined // skipFitAnimation, startUnpinned, selectedNodeIds, spawnDirectory
            )
        })
    })
})

describe('spawnTerminalWithCommandEditor - Settings Persistence', () => {
    let cy: Core
    let mockSpawnTerminalWithContextNode: ReturnType<typeof vi.fn>
    let mockLoadSettings: ReturnType<typeof vi.fn>
    let mockSaveSettings: ReturnType<typeof vi.fn>
    let mockSetMcpIntegration: ReturnType<typeof vi.fn>

    const originalCommand: string = 'claude "$AGENT_PROMPT"'
    const modifiedCommand: string = 'claude --model opus "$AGENT_PROMPT"'

    const defaultSettings: VTSettings = {
        agents: [{ name: 'Claude', command: originalCommand }],
        agentPermissionModeChosen: true,
        INJECT_ENV_VARS: { AGENT_PROMPT: 'original prompt' },
        terminalSpawnPathRelativeToWatchedDirectory: '',
        shiftEnterSendsOptionEnter: false,
        contextNodeMaxDistance: 2,
        askModeContextDistance: 1,
    } as unknown as VTSettings

    beforeEach(() => {
        cy = cytoscape({ headless: true, elements: [] })

        mockSpawnTerminalWithContextNode = vi.fn().mockResolvedValue(undefined)
        mockLoadSettings = vi.fn().mockResolvedValue(defaultSettings)
        mockSaveSettings = vi.fn().mockResolvedValue(undefined)
        mockSetMcpIntegration = vi.fn().mockResolvedValue(undefined)

        global.window = {
            electronAPI: {
                main: {
                    spawnTerminalWithContextNode: mockSpawnTerminalWithContextNode,
                    loadSettings: mockLoadSettings,
                    saveSettings: mockSaveSettings,
                    setMcpIntegration: mockSetMcpIntegration,
                }
            }
        } as unknown as Window & typeof globalThis

        clearTerminals()
    })

    afterEach(() => {
        cy.destroy()
        clearTerminals()
        vi.restoreAllMocks()
    })

    it('BUG: should save agent command to settings when manually modified in popup', async () => {
        // GIVEN: User modifies the command in the popup (e.g., adds --model opus flag)
        const popupResult: AgentCommandEditorResult = {
            command: modifiedCommand,
            agentPrompt: 'original prompt', // unchanged
            mcpIntegrationEnabled: true,
            useDocker: false
        }
        mockShowAgentCommandEditor.mockResolvedValue(popupResult)

        const parentNodeId: NodeIdAndFilePath = 'test-node.md'

        // WHEN: User spawns terminal with command editor
        await spawnTerminalWithCommandEditor(parentNodeId, cy)

        // THEN: Should save settings with the modified command
        expect(mockSaveSettings).toHaveBeenCalled()
        const savedSettings: VTSettings = mockSaveSettings.mock.calls[0][0] as VTSettings

        // The Claude agent command should be updated to the modified command
        const claudeAgent: { readonly name: string; readonly command: string } | undefined = savedSettings.agents.find(a => a.name === 'Claude')
        expect(claudeAgent?.command).toBe(modifiedCommand)
    })
})
