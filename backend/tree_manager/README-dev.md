# Tree Manager - Data Structures & Buffer Management

## Overview

The tree_manager module provides the core data structures and buffer management for VoiceTree's knowledge tree representation. It handles streaming voice input, tree operations, and conversion to markdown format.

## Architecture

```
tree_manager/
├── decision_tree_ds.py              # Core tree data structure
├── unified_buffer_manager.py        # Streaming input buffer management
├── workflow_tree_manager.py        # Workflow-integrated tree manager
├── text_to_tree_manager.py         # Text processing tree manager
├── tree_to_markdown.py             # Tree → Markdown conversion
├── utils.py                        # Tree utility functions
└── LLM_engine/                     # LLM integration components
```

## Core Components

### 🌳 Tree Data Structures

#### `decision_tree_ds.py`
**Purpose**: Core tree data structure for knowledge representation
- Hierarchical node structure with parent-child relationships
- Node metadata (names, summaries, content)
- Tree traversal and manipulation operations
- JSON serialization for persistence

**Key Classes**:
- `DecisionTree`: Main tree structure with CRUD operations
- `TreeNode`: Individual node representation with metadata

**Usage**:
```python
from backend.tree_manager.decision_tree_ds import DecisionTree

tree = DecisionTree()
tree.add_node("AI Research", content="Working on machine learning projects")
tree.add_child("AI Research", "Neural Networks", "Deep learning architectures")
```

#### `tree_to_markdown.py`
**Purpose**: Converts tree structure to markdown files
- Hierarchical markdown generation
- Content preservation and formatting
- File organization and naming
- Backward compatibility with existing markdown trees

**Key Classes**:
- `TreeToMarkdownConverter`: Main conversion engine

### 📊 Buffer Management

#### `unified_buffer_manager.py`
**Purpose**: Handles streaming voice input with intelligent buffering
- Character-count based buffer thresholds
- Incomplete sentence boundary detection
- Transcript history maintenance
- Adaptive processing triggers

**Key Features**:
- `TEXT_BUFFER_SIZE_THRESHOLD`: Configurable buffer size (default: 500 chars)
- Streaming vs discrete processing modes
- Buffer overflow protection
- Context preservation across processing cycles

**Usage**:
```python
from backend.tree_manager.unified_buffer_manager import UnifiedBufferManager

buffer_manager = UnifiedBufferManager(
    buffer_size_threshold=500,
    max_history_length=10
)

# Add streaming text
text_to_process = buffer_manager.add_text("I'm working on a new AI project...")

if text_to_process:
    # Buffer is ready for processing
    process_transcript(text_to_process)
```

### 🔄 Tree Management Layers

#### `base.py`
**Purpose**: Abstract base interface for tree managers
- Common interface for different tree manager implementations
- Standardized processing methods
- Configuration management

#### `workflow_tree_manager.py`
**Purpose**: Basic workflow-integrated tree manager
- Bridges tree operations with agentic workflows
- `WorkflowAdapter` integration
- Atomic processing mode support

#### `enhanced_workflow_tree_manager.py`
**Purpose**: Enhanced manager with TADA + TROA agents
- Dual-agent processing coordination
- Real-time TADA integration
- Background TROA optimization scheduling
- Quality progression tracking (2.5-3/5 → 5/5)

**Key Classes**:
- `EnhancedWorkflowTreeManager`: Main enhanced manager
- Integration with `BackgroundOptimizer` for TROA cycles

#### `text_to_tree_manager.py`
**Purpose**: Text-focused tree processing
- Direct text-to-tree conversion
- Legacy support for non-workflow processing
- Simple tree operations without agentic workflows

## Processing Flow

### Streaming Input Processing
```
Voice Input → Buffer Manager → Threshold Check → Tree Manager → Workflow Adapter → Agentic Pipeline
```

### Enhanced Processing (TADA + TROA)
```
Streaming Input → Enhanced Manager → TADA (Real-time) → Tree Updates
                                    ↓
Background Trigger → TROA Analysis → Optimized Tree Structure
```

### Buffer Management Strategy
1. **Accumulation**: Add incoming text to buffer
2. **Threshold Check**: Monitor buffer size vs threshold
3. **Boundary Detection**: Ensure complete sentences
4. **Processing Trigger**: Release buffer when ready
5. **Context Preservation**: Maintain transcript history

## Key Design Patterns

### Unified Buffer Management
According to project memories, the buffer management system handles streaming vs discrete processing with:
- Character-count thresholds for processing triggers
- Incomplete sentence boundary handling
- Transcript history for context preservation
- Adaptive buffer sizing based on content

### Tree-Workflow Integration
The tree manager serves as the bridge between:
- **Tree Data Structures**: Knowledge representation
- **Agentic Workflows**: LLM processing pipeline
- **Buffer Management**: Streaming input handling
- **Markdown Output**: Final file generation

## Configuration

### Buffer Settings
```python
# In settings.py
TEXT_BUFFER_SIZE_THRESHOLD = 500  # Characters before processing
MAX_TRANSCRIPT_HISTORY = 10       # Number of previous transcripts to keep
```

### Tree Settings
```python
# Tree manager configuration
WORKFLOW_STATE_FILE = "voicetree_state.json"
MARKDOWN_OUTPUT_DIR = "markdownTreeVault/"
```

## Testing

### Unit Tests
- Tree data structure operations
- Buffer management logic
- Markdown conversion accuracy
- Configuration handling

### Integration Tests
- Tree manager ↔ workflow adapter
- Buffer manager ↔ voice input
- Markdown generation ↔ tree structure

## Common Operations

### Adding Content
```python
# Direct tree operation
tree.add_node("Project", "AI research project")

# Via workflow adapter
await enhanced_manager.process_voice_input("Working on AI research")
```

### Tree Traversal
```python
# Get all nodes
all_nodes = tree.get_all_nodes()

# Find specific node
node = tree.find_node("AI Research")

# Get children
children = tree.get_children("AI Research")
```

### Buffer Management
```python
# Add streaming text
buffer_manager.add_text("This is streaming voice input...")

# Check if ready for processing
if buffer_manager.should_process():
    text = buffer_manager.get_buffered_text()
    buffer_manager.clear_buffer()
```

## Navigation

- ← **[Backend Architecture](../README-dev.md)** - Core system overview
- 🤖 **[Agentic Workflows](../agentic_workflows/README-dev.md)** - LLM processing pipeline
- 📊 **[Benchmarker](../benchmarker/README-dev.md)** - Quality testing and performance
- ← **[Main Guide](../../README-dev.md)** - Project overview 