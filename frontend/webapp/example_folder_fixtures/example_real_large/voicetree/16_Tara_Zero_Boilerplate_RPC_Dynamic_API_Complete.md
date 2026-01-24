---
color: navy
position:
  x: 851.3533061652328
  y: 987.5995122096215
isContextNode: false
node_id: 16
agent_name: Tara
---
** Summary**
Implemented the correct zero-boilerplate RPC solution by dynamically fetching API keys from the main process at runtime, eliminating all manual wrapper boilerplate while maintaining full type safety.

** Technical Details**

**Problem with Previous Attempt:**
The previous fix replaced the Proxy with hardcoded function wrappers, which defeated the entire purpose of the zero-boilerplate system. Every new function required manual wrapper code in preload.ts.

**Correct Solution:**
The preload script now dynamically fetches the API shape from the main process at runtime using Object.keys(mainAPI), then generates wrappers automatically.

**Files Modified:**

1. **src/functional/shell/main/edge/rpc-handler.ts**
   - Added `rpc:getApiKeys` handler that returns Object.keys(mainAPI)
   - Provides runtime API shape to preload script

2. **src/electron/preload.ts**
   - Converted to async `exposeElectronAPI()` function
   - Dynamically builds mainAPIWrappers by fetching keys from main process
   - Removed hardcoded settings and graph wrapper objects (legacy boilerplate)
   - Zero-boilerplate maintained: just add to mainAPI, no other changes needed

3. **src/types/electron.d.ts**
   - Removed legacy `settings` property (replaced by main.loadSettings/saveSettings)
   - Removed RPC methods from `graph` object (replaced by main.applyDelta/getGraphState)
   - Graph object now only contains event listeners (onGraphUpdate, onGraphClear)

4. **Renderer files updated to use main.* instead of legacy wrappers:**
   - src/graph-core/services/ContextMenuService.ts
   - src/views/FloatingEditorManager.ts

** Architecture Diagram**

```mermaid
sequenceDiagram
    participant P as Preload Script
    participant IPC as Electron IPC
    participant RPC as rpc-handler
    participant API as mainAPI

    Note over P: Initialization (async)
    P->>IPC: invoke('rpc:getApiKeys')
    IPC->>RPC: Request API keys
    RPC->>API: Object.keys(mainAPI)
    API-->>RPC: ['applyDelta', 'getGraphState', 'loadSettings', 'saveSettings']
    RPC-->>IPC: Return keys array
    IPC-->>P: ['applyDelta', ...]
    
    Note over P: Dynamic wrapper generation
    loop For each key
        P->>P: Create wrapper function
        Note over P: key => (...args) => invoke('rpc:call', key, args)
    end
    
    P->>P: contextBridge.exposeInMainWorld('electronAPI', {main: wrappers})
    
    Note over P: Runtime (renderer calls)
    Note right of P: window.electronAPI.main.loadSettings()
    P->>IPC: invoke('rpc:call', 'loadSettings', [])
    IPC->>RPC: Execute RPC call
    RPC->>API: mainAPI.loadSettings()
    API-->>RPC: Settings object
    RPC-->>IPC: Return result
    IPC-->>P: Settings object
```

** Zero-Boilerplate Flow**

```mermaid
flowchart LR
    subgraph Main Process
        API[mainAPI object<br/>applyDelta<br/>getGraphState<br/>loadSettings<br/>saveSettings]
        KEYS[Object.keys API]
        API --> KEYS
    end
    
    subgraph Preload Script
        FETCH[Fetch keys at startup]
        GEN[Generate wrappers dynamically]
        EXPOSE[Expose to renderer]
        FETCH --> GEN --> EXPOSE
    end
    
    subgraph Renderer
        USE[window.electronAPI.main.*<br/>Full type safety via<br/>'typeof mainAPI']
    end
    
    KEYS -.->|Runtime| FETCH
    EXPOSE --> USE
    
    style API fill:#90EE90
    style GEN fill:#87CEEB
    style USE fill:#FFD700
```

** Single Source of Truth**

```mermaid
graph TD
    A[Add function to mainAPI] --> B{Automatic propagation}
    B --> C[Object.keys includes it]
    B --> D[TypeScript type includes it]
    C --> E[Preload generates wrapper]
    D --> F[Renderer gets type hints]
    E --> G[Available at runtime]
    F --> G
    G --> H[Zero additional code needed\!]
    
    style A fill:#90EE90
    style H fill:#FFD700
```

** Impact**

**Benefits Achieved:**
- ✅ **True zero-boilerplate**: Adding a function to mainAPI requires ZERO changes elsewhere
- ✅ **Full type safety**: typeof mainAPI ensures renderer sees exact function signatures
- ✅ **Single source of truth**: mainAPI is the only place that defines the API shape
- ✅ **No manual synchronization**: Runtime and types automatically stay in sync
- ✅ **Clean architecture**: RPC calls via main.*, event listeners via graph.*/terminal.*, etc.

**Code Eliminated:**
- ❌ Removed hardcoded function wrappers from preload.ts
- ❌ Removed duplicate settings wrapper object
- ❌ Removed duplicate graph RPC wrapper methods
- ❌ Removed unused type definitions

**Testing Results:**
- ✅ TypeScript compilation passes with zero errors
- ✅ All quality checks pass (ESLint, type checking)
- ✅ Smoke test passes electronAPI availability check (progresses to later stages)
- ✅ Renderer code updated to use new pattern

**Architecture Improvements:**
- Clear separation: RPC calls (main.*) vs Event listeners (graph.on*, terminal.on*)
- Eliminated boilerplate wrapper objects that just forwarded to mainAPI
- Type definitions match actual runtime behavior

**Example Usage:**

```typescript
// In mainAPI (main process) - THE ONLY PLACE TO EDIT
export const mainAPI = {
    applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta): Promise<void> => {...
    },
    getGraph: async () => getGraph(),
    loadSettings,
    saveSettings: async (settings: Settings) => {...
    },
    // Add new function here - that's it\!
}

// In renderer - automatically available with full types
const settings = await window.electronAPI.main.loadSettings()
await window.electronAPI.main.saveSettings(newSettings)
const graph = await window.electronAPI.main.getGraphState()
```

**Key Lesson:**
When hitting a technical limitation (Proxy can't be cloned through contextBridge), don't give up on the elegant solution. Instead, find a way to provide the missing runtime information. In this case: fetch API keys from main process at preload initialization.

-----------------
_Links:_
Parent:
- is_progress_of [[./15_Tara_RPC_Proxy_Clone_Error_Fixed.md]]