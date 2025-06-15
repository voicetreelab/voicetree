# VoiceTree LangGraph Implementation

A multi-stage LangGraph pipeline for processing voice transcripts into a knowledge graph structure.

## Overview

This implementation uses LangGraph to create a 4-stage pipeline that:
1. Segments transcripts into atomic ideas
2. Analyzes relationships with existing nodes
3. Decides on integration actions (CREATE/APPEND)
4. Extracts new nodes to create

## Key Features

- **Multi-Stage Processing**: Clear separation of concerns across 4 stages
- **State Management**: Persistent knowledge graph that grows across executions
- **Chunk Boundary Handling**: Properly handles incomplete sentences from voice input
- **LLM Integration**: Uses Gemini for intelligent processing

## Core Components

### Pipeline Files
- `main.py` - Main pipeline class with state management
- `graph.py` - LangGraph workflow definition
- `nodes.py` - Processing nodes for each stage
- `state.py` - State schema definition
- `state_manager.py` - Persistent state management
- `llm_integration.py` - LLM integration layer

### Prompts
- `prompts/` - LLM prompt templates for each stage

## Usage

```python
from workflow.langgraph.main import VoiceTreePipeline

# Create pipeline with persistent state
pipeline = VoiceTreePipeline("knowledge_graph.json")

# Process voice transcripts
pipeline.run("I'm working on a new AI project")
pipeline.run("The AI project uses neural networks")  # Recognizes existing concept

# Get statistics
stats = pipeline.get_statistics()
print(f"Total nodes: {stats['total_nodes']}")
```

## State Management

The pipeline maintains state across executions:
- Existing nodes are summarized and provided as context
- New nodes are added to the persistent graph
- Relationships are preserved between executions

## Chunk Boundary Handling

Handles incomplete sentences from voice input:
- Incomplete chunks are buffered between executions
- Only complete thoughts are processed into nodes
- Prevents fragmentation of ideas

## Testing

Run tests from the tests directory:
```bash
cd tests
python test_state_persistence.py
python test_chunk_boundaries.py
python benchmark_multi_execution.py
```

## Requirements

See the main project `requirements.txt` for dependencies.

## Quick Start

```bash
# Install dependencies (from project root)
pip install -r requirements.txt

# Run with mock LLM responses (no API key needed)
python run_test.py

# Run with real LLM integration
# 1. Add your API key to .env file: GOOGLE_API_KEY=your_api_key_here
# 2. Uncomment the real LLM code in llm_integration.py
# 3. Run the test script
python run_test.py
```

## File Structure

- `state.py` - State schema definition
- `nodes.py` - Node functions for each stage  
- `graph.py` - Graph definition and flow control
- `main.py` - Main pipeline runner
- `llm_integration.py` - LLM API integration
- `test_pipeline.py` - Standalone test script
- `run_test.py` - Simple script to run the pipeline
- `prompts/` - Individual prompt files for each stage

## Usage Example

```python
from main import run_voicetree_pipeline

transcript = "Today I want to work on my project..."
existing_nodes = "Project Planning: Main project node..."

result = run_voicetree_pipeline(transcript, existing_nodes)
new_nodes = result["new_nodes"]
```

## Key Benefits

- **Modular**: Each stage is independently testable
- **LLM-Friendly**: Simple files that LLMs can easily modify
- **Production-Ready**: Error handling, state management, logging
- **Integration-Ready**: Easy to integrate with existing VoiceTree backend

## Next Steps

1. Add valid API key to use real LLM integration
2. Benchmark against single-LLM approach using quality_LLM_benchmarker.py
3. Integrate with existing VoiceTree backend 