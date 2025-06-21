# Chunk Processing Pipeline

This module handles the processing of text chunks through the agentic workflow pipeline.

## Overview

The `ChunkProcessor` class is responsible for:

1. **Receiving text chunks** - From the text buffer manager when chunks are ready
2. **Gathering context** - Retrieving relevant nodes and tree state
3. **Calling agentic workflows** - Processing chunks through the 4-stage pipeline
4. **Updating the tree** - Applying the resulting node actions to the decision tree

## Architecture

```
Text Chunk → ChunkProcessor → Workflow Adapter → Agentic Workflows → Tree Updates
                    ↓
             Decision Tree
             (context & updates)
```

## Key Components

### ChunkProcessor
- Main orchestrator for chunk processing
- Manages buffer state and tree updates
- Coordinates between buffer manager, workflow adapter, and decision tree

## Usage

```python
from chunk_processing_pipeline import ChunkProcessor
from tree_manager.decision_tree_ds import DecisionTree

# Initialize
tree = DecisionTree()
processor = ChunkProcessor(tree)

# Process voice input
await processor.process_voice_input("Some transcribed text")
```

## Dependencies

- `TextBufferManager` - For buffering and chunk detection
- `WorkflowAdapter` - For interfacing with agentic workflows
- `DecisionTree` - The knowledge tree structure