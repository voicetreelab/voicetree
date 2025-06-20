# VoiceTree Architecture with Agentic Workflows

## Overview

The VoiceTree system uses a multi-stage agentic workflow (LangGraph) for processing voice transcripts into a knowledge tree structure. The architecture maintains clean separation of concerns with well-defined layers.

## Architecture Layers

### 1. Voice Input Layer
- **Location**: `backend/voice_to_text/`
- **Purpose**: Captures and transcribes voice input
- **Key Components**: `VoiceToTextEngine`

### 2. VoiceTree Backend Layer
- **Location**: `backend/`
- **Purpose**: Core business logic and tree management
- **Key Components**:
  - `main.py`: Application entry point
  - `tree_manager/`: Tree data structures and operations
  - `process_transcription.py`: Transcript processing logic

### 3. Workflow Orchestration Layer
- **Location**: `backend/workflow_adapter.py`
- **Purpose**: Interface between VoiceTree and agentic workflows
- **Key Components**:
  - `WorkflowAdapter`: Translates between backend and workflow
  - `WorkflowResult`: Standardized result format
  - `WorkflowMode`: Execution modes (atomic/streaming)

### 4. Agentic Workflow Layer
- **Location**: `backend/agentic_workflows/`
- **Purpose**: Multi-stage LLM processing pipeline
- **Key Components**:
  - `graph_definition.py`: Pure workflow structure
  - `workflow_interface.py`: Abstract workflow API
  - `prompts/`: Text-only prompt templates
  - `visualizer.py`: Workflow visualization tools

### 5. State Management Layer
- **Purpose**: Shared state between VoiceTree and workflows
- **Key Components**:
  - `DecisionTree`: Core tree structure
  - `VoiceTreeStateManager`: Workflow state persistence
  - JSON persistence for both systems

## Key Design Decisions

### 1. Separation of Concerns
- **Prompts**: Stored as pure text files, no code
- **Graph Structure**: Declarative definition separate from execution
- **Business Logic**: Kept in backend, not in workflow nodes
- **State Management**: Shared abstraction layer

### 2. Atomic Workflow Execution
- Workflows run as atomic operations
- State changes only applied after successful completion
- Simplifies error handling and rollback
- Future support for streaming mode if needed

### 3. Multi-Stage Processing
- **Stage 1**: Segmentation - Break transcript into atomic ideas
- **Stage 2**: Relationship Analysis - Analyze connections to existing nodes
- **Stage 3**: Integration Decision - Decide CREATE or APPEND actions
- **Stage 4**: Node Extraction - Extract new nodes to create

### 4. Minimal Dependencies
- LangGraph is optional (graceful fallback)
- Mock implementations for testing
- Clear interfaces between layers

## Processing Flow

```
1. Voice Input → VoiceToTextEngine
2. Transcript → WorkflowTreeManager
3. WorkflowAdapter prepares state snapshot
4. Agentic workflow processes transcript:
   a. Segmentation into chunks
   b. Relationship analysis
   c. Integration decisions
   d. Node extraction
5. Results converted to NodeActions
6. Actions applied atomically to tree
7. Tree updates → Markdown export
```

## File Structure

```
backend/
├── workflow_adapter.py          # Integration layer
├── tree_manager/
│   └── workflow_tree_manager.py # Workflow-based tree manager
├── agentic_workflows/
│   ├── graph_definition.py      # Pure workflow structure
│   ├── workflow_interface.py    # Abstract API
│   ├── visualizer.py           # Visualization tools
│   ├── prompts/                # Text prompt templates
│   ├── graph.py                # LangGraph implementation
│   ├── nodes.py                # Node processing logic
│   └── state_manager.py        # Workflow state persistence
└── example_integration.py       # Usage examples
```

## Usage Examples

### Basic Usage
```python
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager

# Create tree manager with workflow
tree_manager = WorkflowTreeManager(
    decision_tree=decision_tree,
    workflow_state_file="workflow_state.json"
)

# Process voice input (uses agentic workflow)
await tree_manager.process_voice_input(transcript)
```

### Workflow Statistics
```python
# Get workflow performance metrics
stats = tree_manager.get_workflow_statistics()
print(f"Total nodes: {stats['total_nodes']}")
```

### Workflow Visualization
```python
from backend.agentic_workflows.visualizer import WorkflowVisualizer

visualizer = WorkflowVisualizer()
visualizer.generate_html_visualization("workflow.html")
```

## Benefits

1. **Superior Quality**: Multi-stage processing produces better tree structures
2. **Clean Architecture**: Clear separation between layers
3. **Maintainability**: Each component has a single responsibility
4. **Testability**: Layers can be tested independently
5. **Extensibility**: Easy to modify prompts or workflow stages
6. **LLM-Friendly**: Simple files that LLMs can easily understand and modify

## Benchmarking

The system includes a quality benchmarker that:
1. Processes transcripts through the agentic workflow
2. Evaluates output quality using LLM assessment
3. Tracks performance across different versions
4. Logs results with git commit information

Run benchmarks with:
```bash
python backend/tests/integration_tests/live_system/quality_tests/quality_LLM_benchmarker.py
```

## Future Enhancements

1. **Streaming Mode**: Process state changes during workflow execution
2. **Workflow Versioning**: Track and manage workflow versions
3. **Custom Workflows**: Allow users to define their own workflows
4. **Performance Optimization**: Parallel processing of independent stages
5. **Advanced Visualizations**: Interactive workflow debugging tools 