# Backend - Core System Architecture

## Overview

The backend contains the core VoiceTree system orchestration, combining voice input processing, tree management, and agentic workflow coordination into a unified voice-to-knowledge-graph pipeline.

## Architecture

```
backend/
├── main.py                                    # System entry point & orchestration
├── enhanced_transcription_processor.py       # TADA + TROA dual-agent processor
├── workflow_adapter.py                      # Backend ↔ Agentic workflow bridge
├── settings.py                             # System configuration
├── tree_reorganization_agent.py           # Background optimization agent (TROA)
├── voice_to_text/                         # Voice capture & transcription
├── tree_manager/                          # Tree data structures & buffer management
├── agentic_workflows/                     # 4-stage LLM processing pipeline
├── benchmarker/                          # Quality testing & performance measurement
└── tests/                               # Unit & integration tests
```

## Core Components

### 🚀 System Entry Points

#### `main.py`
**Purpose**: Primary system orchestration and event loop
- Creates enhanced transcription processor with TADA + TROA agents
- Initializes voice-to-text engine
- Manages async processing loop with background optimization
- Coordinates system startup and shutdown

**Usage**:
```python
# Enhanced system with dual agents
decision_tree = DecisionTree()
processor = create_enhanced_transcription_processor(
    decision_tree=decision_tree,
    workflow_state_file="voicetree_enhanced_state.json",
    enable_background_optimization=True,
    optimization_interval_minutes=2
)

# Start processing
await processor.enhanced_tree_manager.start_enhanced_processing()
```

#### `enhanced_transcription_processor.py`
**Purpose**: Enhanced processing system with TADA + TROA agents
- **TADA** (Tree Action Decider Agent): Real-time processing (2.5-3/5 quality)
- **TROA** (Tree Reorganization Agent): Background optimization (5/5 quality)
- Unified buffer management for streaming input
- Background optimization scheduling

**Key Classes**:
- `EnhancedTranscriptionProcessor`: Main processor coordinating both agents
- `BackgroundOptimizer`: Manages TROA background optimization cycles

### 🔗 System Integration

#### `workflow_adapter.py`
**Purpose**: Bridge between VoiceTree backend and agentic workflows
- Translates between backend `NodeAction` and workflow decision formats
- Handles state translation and result mapping
- Supports both atomic and streaming execution modes
- Manages incomplete text buffering

**Key Classes**:
- `WorkflowAdapter`: Main interface between systems
- `WorkflowResult`: Standardized result format
- `WorkflowDecision`: Bridge format for integration decisions

#### `tree_reorganization_agent.py`
**Purpose**: Background optimization agent (TROA)
- Analyzes tree structure for optimization opportunities
- Performs content reorganization and hierarchy improvements
- Maintains backward compatibility with markdown files
- Provides 5/5 quality output through careful analysis

### ⚙️ Configuration

#### `settings.py`
**Purpose**: Centralized system configuration
- API keys and LLM settings
- Buffer size thresholds and processing parameters
- File paths and output directories
- Debug and logging configuration

**Key Settings**:
- `TEXT_BUFFER_SIZE_THRESHOLD`: Character count for processing trigger
- `GOOGLE_API_KEY`: Gemini API authentication
- `WORKFLOW_STATE_FILE`: Persistent state location

## System Flow

### Real-Time Processing (TADA)
```
Voice Input → Transcription → Buffer Management → TADA → Quick Tree Updates
```

### Background Optimization (TROA)
```
Periodic Trigger → Tree Analysis → TROA → Optimized Tree Structure
```

### Quality Progression
```
Voice Input → TADA (2.5-3/5) → TROA (5/5) → Final Output
```

## Development Patterns

### Import System (Fixed)
According to project memories, the import system was the #1 developer productivity killer before being fixed. The solution involved:
- Robust settings imports supporting both execution contexts
- Elimination of circular imports by defining `NodeAction` locally per module
- Removal of 40+ `sys.path.append()` hacks

### Natural Workflow Test
Can a new contributor clone the repo and immediately run scripts the way they'd naturally expect?
```bash
cd backend/
python main.py  # Should work without path manipulation
```

### Atomic Testing Philosophy
All complex systems must be testable with a single command:
```bash
make test-benchmarker  # Validates entire system pipeline
```

## Key Dependencies

- **LangGraph**: Agentic workflow execution framework
- **langchain-core**: LLM integration foundation
- **google-generativeai**: Gemini API integration
- **asyncio**: Async processing for real-time voice handling

## Testing

- **Unit Tests**: `tests/unit_tests/` - Component isolation testing
- **Integration Tests**: `tests/integration_tests/` - Cross-module functionality
- **Pipeline Tests**: `pipeline_system_tests/` - End-to-end system validation

## Navigation

- 🌳 **[Tree Manager](tree_manager/README-dev.md)** - Data structures and buffer management
- 🤖 **[Agentic Workflows](agentic_workflows/README-dev.md)** - LLM processing pipeline  
- 📊 **[Benchmarker](benchmarker/README-dev.md)** - Quality testing and performance
- ← **[Back to Main Guide](../README-dev.md)** - Project overview 