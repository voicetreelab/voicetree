# VoiceTree Agentic Workflows

A multi-stage AI pipeline for processing voice transcripts into knowledge graphs using LangGraph.

## How It Works

The system processes voice input through 4 stages:

1. **Segmentation** - Breaks transcripts into atomic ideas
2. **Relationship Analysis** - Analyzes connections to existing knowledge
3. **Integration Decision** - Decides whether to create new nodes or append to existing ones
4. **Node Extraction** - Creates the final knowledge tree structure

## Key Features

- **Persistent State** - Knowledge graph grows across multiple voice inputs
- **Chunk Boundary Handling** - Handles incomplete sentences from streaming voice input
- **LLM Integration** - Uses Gemini for intelligent processing at each stage

## Usage

```python
from backend.agentic_workflows.main import VoiceTreePipeline

# Create pipeline with persistent state
pipeline = VoiceTreePipeline("knowledge_graph.json")

# Process voice transcripts
pipeline.run("I'm working on a new AI project")
pipeline.run("The AI project uses neural networks")  # Recognizes existing concept

# Get statistics
stats = pipeline.get_statistics()
print(f"Total nodes: {stats['total_nodes']}")
```

## Core Components

- `main.py` - Main pipeline class with state management
- `graph.py` - LangGraph workflow compilation
- `graph_definition.py` - Workflow structure definition  
- `nodes.py` - Processing nodes for each stage
- `state.py` - State schema definition
- `state_manager.py` - Persistent state management
- `llm_integration.py` - LLM integration layer (Gemini API)
- `infrastructure/` - Additional execution infrastructure
- `prompts/` - LLM prompt templates for each stage

## State Management

The pipeline maintains knowledge across executions:
- Existing nodes are summarized and provided as context
- New nodes are added to the persistent graph
- Relationships are preserved between voice sessions

## Quick Start

```bash
# Install dependencies (from project root)
pip install -r requirements.txt

# Set up API key
export GOOGLE_API_KEY="your_gemini_api_key"

# Run a test
python run_test.py
```

## Testing

Run tests from the project root:
```bash
# Unit tests
python -m pytest backend/tests/unit_tests/agentic_workflows/

# Integration tests
python -m pytest backend/tests/integration_tests/agentic_workflows/
```

## Integration

This workflow system integrates with the main VoiceTree backend through the `WorkflowAdapter` class in `backend/workflow_adapter.py`. 