# VoiceTree Pipeline Architecture

## Overview

The new two-step pipeline replaces the monolithic TreeActionDeciderAgent with a cleaner orchestration pattern that separates placement from optimization.

## System Architecture

```mermaid
graph TB
    subgraph "Voice Processing"
        VI[Voice Input] --> STT[Speech-to-Text]
        STT --> TBM[TextBufferManager]
    end
    
    subgraph "Chunk Processing Layer"
        TBM --> CP[ChunkProcessor]
        CP --> WA[WorkflowAdapter]
    end
    
    subgraph "Two-Step Pipeline (NEW)"
        WA --> TD[TreeActionDecider<br/>Orchestrator]
        TD --> AA[AppendToRelevantNodeAgent]
        TD --> TA[TreeActionApplier]
        TD --> SO[SingleAbstractionOptimizerAgent]
    end
    
    subgraph "Output"
        CP --> TMC[TreeToMarkdownConverter]
        TMC --> MD[Markdown Files]
    end
    
    style TD fill:#f9f,stroke:#333,stroke-width:4px
    style AA fill:#bbf,stroke:#333,stroke-width:2px
    style SO fill:#bbf,stroke:#333,stroke-width:2px
```

## Execution Flow

```mermaid
sequenceDiagram
    participant CP as ChunkProcessor
    participant WA as WorkflowAdapter
    participant TD as TreeActionDecider
    participant AA as AppendAgent
    participant TA as TreeApplier
    participant SO as OptimizerAgent
    
    CP->>WA: process_full_buffer(text)
    WA->>TD: run(transcript, tree)
    
    Note over TD,AA: Step 1: Fast Placement
    TD->>AA: Get placement actions
    AA-->>TD: [AppendAction, CreateAction]
    
    TD->>TA: Apply placement internally
    TA-->>TD: Modified node IDs
    
    Note over TD,SO: Step 2: Thoughtful Optimization
    loop For each modified node
        TD->>SO: Optimize node
        SO-->>TD: [UpdateAction, CreateAction]
    end
    
    TD-->>WA: Optimization actions only
    WA-->>CP: WorkflowResult
```

## Action Types & Flow

```mermaid
graph TB
    subgraph "TreeActionDecider (Internal)"
        T[Transcript] --> PA[Placement Actions<br/>AppendAction/CreateAction]
        PA --> MN[Modified Nodes]
        MN --> OA[Optimization Actions<br/>UpdateAction/CreateAction]
    end
    
    subgraph "External Caller"
        OA --> EC[ChunkProcessor<br/>Receives ONLY<br/>optimization actions]
    end
    
    style PA fill:#fcc,stroke:#333,stroke-width:2px
    style OA fill:#cfc,stroke:#333,stroke-width:2px
```

**Key Point**: Placement actions are internal. Only optimization actions are returned.

## Component Structure

```mermaid
classDiagram
    class TreeActionDecider {
        -AppendToRelevantNodeAgent append_agent
        -SingleAbstractionOptimizerAgent optimizer_agent
        -TreeActionApplier applier
        +run(transcript, tree) List~Action~
    }
    
    class BaseTreeAction {
        <<abstract>>
        +action: str
    }
    
    class AppendAction {
        +target_node_id: int
        +content: str
    }
    
    class CreateAction {
        +parent_node_id: int?
        +new_node_name: str
        +content: str
    }
    
    class UpdateAction {
        +node_id: int
        +new_content: str
        +new_summary: str
    }
    
    BaseTreeAction <|-- AppendAction
    BaseTreeAction <|-- CreateAction
    BaseTreeAction <|-- UpdateAction
```

## Integration Changes Required

### 1. WorkflowAdapter
```python
# Change import
from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider

# Update initialization
self.agent = agent or TreeActionDecider()

# Update return to handle optimization actions only
```

### 2. ChunkProcessor
```python
# FROM:
updated_nodes = self.tree_action_applier.apply_integration_decisions(result.integration_decisions)

# TO:
updated_nodes = self.tree_action_applier.apply(result.tree_actions)
```

## Architecture Issues & Solutions

| Issue | Current State | Solution |
|-------|--------------|----------|
| Action Types | Mixed placement and optimization | Placement internal, only optimization returned |
| Return Format | All actions returned | Only final optimization actions |
| Chunk Tracking | Agent tracks chunks | Orchestrator returns processed text metadata |

## Directory Structure

```
backend/text_to_graph_pipeline/
├── chunk_processing_pipeline/     # Existing, keep as-is
│   ├── chunk_processor.py
│   ├── workflow_adapter.py      # Update to use new orchestrator
│   └── apply_tree_actions.py
├── agentic_workflows/
│   └── agents/                  # LLM-powered agents
│       ├── append_to_relevant_node_agent.py
│       └── single_abstraction_optimizer_agent.py
└── orchestration/               # NEW
    └── tree_action_decider.py  # Deterministic orchestrator
```

## Key Design Principles

1. **Separation of Concerns**: Agents do LLM work, orchestrator coordinates
2. **Two-Step Process**: Fast placement → Thoughtful optimization  
3. **Internal vs External Actions**: Placement stays internal, optimization is exposed
4. **Minimal Changes**: Reuse existing infrastructure where possible