# Agentic Workflows - 4-Stage LLM Processing Pipeline

## Overview

The agentic_workflows module implements a sophisticated 4-stage LangGraph-based pipeline that transforms voice transcripts into structured knowledge trees using coordinated AI agents.

## Architecture

```
agentic_workflows/
├── main.py                        # Pipeline orchestration & entry point
├── graph.py                       # LangGraph workflow compilation
├── graph_definition.py            # Declarative workflow structure
├── nodes.py                       # Processing nodes for each stage
├── state.py                       # State schema definition
├── state_manager.py              # Persistent state management
├── workflow_interface.py          # Abstract workflow API
├── llm_integration.py            # Gemini API integration
├── prompt_engine.py              # Dynamic prompt generation
├── schema_models.py              # Data models and validation
├── visualizer.py                 # Workflow visualization tools
├── debug_logger.py               # Comprehensive debugging
├── infrastructure/               # Additional execution infrastructure
├── agents/                      # Specialized agent implementations
├── core/                        # Core workflow utilities
└── prompts/                     # LLM prompt templates (text-only)
```

## 4-Stage Processing Pipeline

### Stage 1: Segmentation
**Purpose**: Breaks transcript into atomic idea chunks
- Identifies logical breakpoints in continuous speech
- Creates coherent, self-contained content segments
- Handles incomplete sentences from streaming input
- Preserves context across segment boundaries

**Quality Metrics**:
- Content Completeness (40pts)
- Chunk Coherence (30pts)
- Boundary Logic (20pts)
- Size Appropriateness (10pts)

### Stage 2: Relationship Analysis
**Purpose**: Analyzes connections to existing knowledge
- Evaluates semantic relationships to existing nodes
- Assesses context quality and conversation flow
- Determines relationship strength and relevance
- Provides foundation for integration decisions

**Quality Metrics**:
- Context Quality (25pts)
- Relationship Detection (35pts)
- Relationship Strength (25pts)
- Conversation Flow (15pts)

### Stage 3: Integration Decision
**Purpose**: Decides CREATE vs APPEND actions
- Makes strategic decisions about knowledge organization
- Balances new node creation vs content augmentation
- Synthesizes content for optimal tree structure
- Provides decision rationale and confidence

**Quality Metrics**:
- Decision Balance (20pts)
- Content Quality (40pts)
- Decision Logic (25pts)
- Content Synthesis (15pts)

**Decision Types**:
- **CREATE**: New knowledge node with unique concepts
- **APPEND**: Augment existing node with related content

### Stage 4: Node Extraction
**Purpose**: Creates final knowledge tree structure
- Extracts precise node names and hierarchies
- Ensures name uniqueness and concept accuracy
- Maintains hierarchy awareness and relationships
- Generates final tree modifications

**Quality Metrics**:
- Name Quality (40pts)
- Name Uniqueness (20pts)
- Concept Accuracy (25pts)
- Hierarchy Awareness (15pts)

## Core Components

### 🚀 Pipeline Orchestration

#### `main.py`
**Purpose**: Main pipeline class with state management
- `VoiceTreePipeline`: Primary orchestration class
- Character-count buffering with configurable thresholds
- Persistent state management across executions
- Result summarization and statistics

**Usage**:
```python
from backend.agentic_workflows.main import VoiceTreePipeline

# Create pipeline with persistent state
pipeline = VoiceTreePipeline("knowledge_graph.json", buffer_threshold=500)

# Process voice transcript
result = pipeline.run("I'm working on a new AI project")

# Get statistics
stats = pipeline.get_statistics()
```

#### `graph.py` & `graph_definition.py`
**Purpose**: LangGraph workflow compilation and structure
- Declarative workflow definition separate from execution
- Clean separation between structure and business logic
- Workflow compilation with error handling
- State transition management

### 🧠 LLM Integration

#### `llm_integration.py`
**Purpose**: Gemini API integration layer
- Centralized LLM interaction management
- Error handling and retry logic
- Response parsing and validation
- Token usage tracking

#### `prompt_engine.py`
**Purpose**: Dynamic prompt generation
- Template-based prompt construction
- Context-aware prompt adaptation
- Variable substitution and formatting
- Prompt optimization for each stage

### 🔄 State Management

#### `state.py`
**Purpose**: State schema for pipeline flow
- `VoiceTreeState`: TypedDict defining pipeline state
- Stage-specific output structures
- Error handling and metadata tracking
- Type safety across pipeline stages

#### `state_manager.py`
**Purpose**: Persistent knowledge graph state
- Node persistence across executions
- Execution history tracking
- State statistics and analytics
- JSON-based state serialization

**Key Features**:
- Incremental knowledge building
- Node relationship tracking
- Execution statistics
- State file management

### 🔍 Development Tools

#### `visualizer.py`
**Purpose**: Workflow visualization and debugging
- Pipeline flow visualization
- State transition tracking
- Performance bottleneck identification
- Debug output generation

#### `debug_logger.py`
**Purpose**: Comprehensive debugging infrastructure
- Stage-by-stage execution logging
- Error tracking and analysis
- Performance metrics collection
- Debug output formatting

## Quality Scoring Framework

According to project memories, the system implements a comprehensive 4-stage scoring framework:

### Overall Score Calculation
```
Overall Score = (Segmentation × 20%) + (Relationship × 25%) + (Integration × 35%) + (Extraction × 20%)
```

### Stage Weights
- **Segmentation**: 20% - Foundation quality
- **Relationship Analysis**: 25% - Context understanding
- **Integration Decision**: 35% - Decision quality (highest weight)
- **Node Extraction**: 20% - Final output quality

### Score Ranges
- **0-60**: Poor quality, requires immediate attention
- **60-75**: Adequate quality, room for improvement
- **75-85**: Good quality, minor optimizations needed
- **85-95**: Excellent quality, production ready
- **95-100**: Outstanding quality, optimal performance

## Processing Modes

### Atomic Mode (Default)
- Complete transcript processing in single execution
- Full state persistence after completion
- Optimal for batch processing and testing

### Streaming Mode
- Incremental processing with buffer management
- Real-time state updates
- Optimal for live voice input

## Configuration

### API Settings
```python
# In settings.py
GOOGLE_API_KEY = "your_gemini_api_key"
LLM_MODEL = "gemini-1.5-flash"
LLM_TEMPERATURE = 0.1
```

### Pipeline Settings
```python
BUFFER_THRESHOLD = 500  # Characters before processing
MAX_RETRIES = 3         # LLM retry attempts
TIMEOUT_SECONDS = 30    # Request timeout
```

## Development Patterns

### Separation of Concerns
- **Prompts**: Pure text files, no code
- **Graph Structure**: Declarative definition
- **Business Logic**: Kept in nodes, not workflow structure
- **State Management**: Shared abstraction layer

### Error Handling
- Graceful degradation on LLM failures
- Retry logic with exponential backoff
- Partial result preservation
- Error state tracking

### Testing Strategy
- Stage-by-stage unit testing
- Integration testing with mock LLM responses
- End-to-end pipeline validation
- Quality regression detection

## Common Operations

### Running the Pipeline
```python
# Basic usage
result = pipeline.run("Transcript text here")

# With existing context
result = pipeline.run("New text", existing_nodes="Node1, Node2")

# Check for errors
if result.get("error_message"):
    print(f"Pipeline error: {result['error_message']}")
```

### Accessing Stage Results
```python
# Get segmentation results
chunks = result.get("chunks", [])

# Get integration decisions
decisions = result.get("integration_decisions", [])

# Get final nodes
new_nodes = result.get("new_nodes", [])
```

### State Management
```python
# Get execution statistics
stats = pipeline.get_statistics()
print(f"Total nodes: {stats['total_nodes']}")
print(f"Recent additions: {stats['recent_additions']}")

# Manual state management
pipeline.state_manager.add_nodes(["New Node"], execution_result)
```

## Testing

### Atomic Testing
According to project memories, the system follows strict atomic testing philosophy:
```bash
make test-benchmarker  # Validates entire 4-stage pipeline
```

### Unit Testing
- Individual stage node testing
- State schema validation
- LLM integration mocking
- Prompt template verification

### Integration Testing
- Multi-stage pipeline flow
- State persistence across executions
- Error recovery testing
- Performance benchmarking

## Navigation

- ← **[Backend Architecture](../README-dev.md)** - Core system overview
- 🌳 **[Tree Manager](../tree_manager/README-dev.md)** - Data structures and buffer management
- 📊 **[Benchmarker](../benchmarker/README-dev.md)** - Quality testing and performance
- ← **[Main Guide](../../README-dev.md)** - Project overview 