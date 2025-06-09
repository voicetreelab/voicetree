# VoiceTree LangGraph Implementation

A standalone LangGraph implementation of the advanced multi-stage VoiceTree processing pipeline.

## Pipeline Overview

Processes voice transcripts through 4 sequential stages:

1. **Segmentation** - Splits transcript into atomic idea chunks
2. **Relationship Analysis** - Identifies connections between chunks and existing nodes  
3. **Integration Decision** - Decides whether to APPEND or CREATE for each chunk
4. **Node Extraction** - Extracts final list of new nodes to create

## Quick Start

```bash
# Install dependencies
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