# VoiceTree Agent Launching System Architecture

## Overview

The VoiceTree agent launching system provides a modular framework for deploying LLM agents with consistent environment setup, context provision, and markdown tree integration. The system supports both Claude and Gemini backends with identical setup flows.

## Architecture Diagram

```mermaid
flowchart TD
    A[User/Juggl Terminal] --> B{Agent Type}
    B -->|Claude Agent| C[./tools/claude.sh]
    B -->|Gemini Agent| D[./tools/gemini.sh]
    
    C --> E[common_agent_setup.sh]
    D --> E
    
    E --> F[check_obsidian_env]
    E --> G[assign_agent_color]
    E --> H[generate_dependency_graph]
    E --> I[read_source_note_content]
    
    F --> J{Environment Valid?}
    J -->|No| K[Exit with Error]
    J -->|Yes| L[Continue Setup]
    
    G --> M[Extract/Assign Color]
    H --> N[graph_dependency_traversal_and_accumulate_graph_content.py]
    I --> O[Read Source Note Content]
    
    L --> P[envsubst prompt substitution]
    P --> Q{Launcher Type}
    Q -->|Claude| R[claude --model sonnet --settings .claude/settings.json]
    Q -->|Gemini| S[gemini --model gemini-2.5-pro]
    
    R --> T[Agent Execution with prompt_main.md]
    S --> T
    
    T --> U[Agent receives RELEVANT_CONTEXT]
    T --> V[Agent receives OBSIDIAN_SOURCE_NOTE_CONTENT]
    T --> W[Agent receives AGENT_COLOR]
    
    U --> X[Agent Processing]
    V --> X
    W --> X
    
    X --> Y{Agent Type}
    Y -->|Orchestrator| Z[Creates subtasks using SUBAGENT_PROMPT.md template]
    Y -->|Subtask Agent| AA[Executes specific task]
    
    Z --> BB[python add_new_node.py for subtask creation]
    AA --> BB[python add_new_node.py for progress updates]
    
    BB --> CC[Markdown Tree Update]
    CC --> DD[YAML frontmatter with node_id, title, color]
    CC --> EE[Automatic parent-child linking]
    
    classDef launcher fill:#e1f5fe
    classDef setup fill:#f3e5f5
    classDef agent fill:#e8f5e8
    classDef output fill:#fff3e0
    
    class C,D launcher
    class E,F,G,H,I setup
    class T,X,Y,Z,AA agent
    class BB,CC,DD,EE output
```

## Key Components

### Agent Launchers
- **`claude.sh`**: Main agent launcher using Claude Sonnet model
- **`gemini.sh`**: Alternative launcher using Gemini 2.5 Pro model
- Both use identical setup flow through `common_agent_setup.sh`

### Common Setup Functions (`common_agent_setup.sh`)
1. **Environment Validation**: Checks for required `OBSIDIAN_SOURCE_NOTE` environment variable
2. **Color Assignment**: Extracts existing color from source note or assigns random color for visual differentiation
3. **Dependency Graph Generation**: Runs graph traversal to provide relevant context
4. **Source Note Reading**: Loads the content of the spawning markdown note

### Prompt Templates
- **`prompt_main.md`**: Main orchestrator agent prompt with enhanced content requirements
- **`SUBAGENT_PROMPT.md`**: Template for creating focused subtask agents
- **`NODE_CREATION_REMINDER.md`**: Guidelines for creating rich progress nodes

### Node Creation System (`add_new_node.py`)
- Automatic node ID generation using hierarchical numbering
- YAML frontmatter with metadata (node_id, title, color)
- Automatic parent-child linking in markdown tree
- Header sanitization to prevent rendering issues

### Configuration
- **`.claude/settings.json`**: Claude-specific settings including hooks for reminders and validation
- **Environment Variables**: `AGENT_COLOR`, `OBSIDIAN_SOURCE_NOTE`, `OBSIDIAN_VAULT_PATH`, etc.

## Agent Types

### Orchestrator Agents
- Receive high-level tasks and break them into subtasks
- Use `SUBAGENT_PROMPT.md` template to create focused sub-agents
- Create subtask nodes using `add_new_node.py` with specific colors

### Subtask Agents  
- Execute focused, specific tasks within larger workflows
- Inherit color from parent task for visual consistency
- Create progress nodes documenting technical changes with Mermaid diagrams

## Key Features

### Modular Agent Deployment
- Common setup ensures consistent environment across all agents
- Pluggable LLM backends (Claude/Gemini) with identical interfaces

### Dynamic Color Assignment
- Visual differentiation of agent contributions in markdown tree
- Color inheritance from parent tasks to subtasks
- Random assignment when no parent color exists

### Context-Aware Execution
- Agents receive relevant dependency graph content via TF-IDF search
- Source note content provides task-specific context
- Environment variables pass metadata between system components

### Automated Tree Management
- Node creation with proper hierarchical linking
- Automatic YAML frontmatter generation
- Header sanitization for consistent rendering

### Rich Progress Tracking
- Mandatory Mermaid diagrams in all progress nodes
- Structured content format: Summary, Technical Details, Architecture Diagram, Impact
- Visual representation of system changes and architectural evolution

## Usage Examples

### Launching a Claude Agent
```bash
# Set environment variables (typically done by Juggl terminal)
export OBSIDIAN_SOURCE_NOTE="2025-08-08/8_Request_for_Architecture_Diagram.md"
export OBSIDIAN_VAULT_PATH="$USER_ROOT_DIR/repos/VoiceTree/markdownTreeVault"

# Launch agent
./tools/claude.sh
```

### Creating Progress Nodes
```bash
# From within an agent
python tools/add_new_node.py "$OBSIDIAN_VAULT_PATH/$OBSIDIAN_SOURCE_NOTE" \
  "Progress Update Title" \
  "## Summary\n[Accomplishment]\n\n## Technical Details\n...\n\n## Mermaid Diagram\n..." \
  is_progress_of
```

## System Benefits

- **Scalable Architecture**: Easy to add new LLM backends or agent types
- **Visual Traceability**: Color-coded progress tracking with architectural diagrams  
- **Consistent Environment**: Shared setup eliminates configuration drift
- **Rich Documentation**: Automatic generation of detailed progress records
- **Context Preservation**: Dependency graphs maintain awareness of related work