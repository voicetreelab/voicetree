VoiceTree is a platform for creating abstraction graphs from content streams, such as live voice, or LLM chats. 
Some popular use cases are:
- Using VoiceTree for day to day work, organizing your tasks & decisions
- Deep problem-solving: let the tree offload your working memory, free your cognition.
- Human-Agent collaboration. Let agents continue building your tree in the background.
- Compressing LLM context inputs. Solves the LLM long context problem.


#### Agentic Workflow 

The Tree-Action-Decider-Agent processes small chunks of text (1-3 sentences) and updates a tree representation.
**Core Pipeline Stages:**
1. **Segmentation** - Breaks transcripts into atomic phrases
2. **Target Node Identification** - Analyzes connections to existing nodes
3. **Single Node optimisation** - Divides into abstractions

Future pipeline: Tree reorganization agent (transcript_history, modified_sub_tree) -> optimal_sub_tree
### Key Configuration
backend/settings.py
backend/text_to_graph_pipeline/voice_to_text/voice_config.py
backend/benchmarker/src/config.py

## Quick Start

### Prerequisites

```bash
# Install dependencies
pip install -r requirements.txt

# Set up API key (save to .env)
echo "GOOGLE_API_KEY=your_gemini_api_key" > .env
```

### Essential Commands

```bash
# Run the main system
python backend/main.py

# Run unit tests
pytest backend/tests/unit_tests

# Run integration tests
pytest backend/tests/integration_tests/

# Run benchmarker for quality testing
python backend/benchmarker/src/quality_LLM_benchmarker.py
```

All tests and scripts should always be run from the root directory for consistency.


### Quality Debugging Workflow
1. Run benchmarker to generate output: `python -m backend.benchmarker.src.quality_LLM_benchmarker`
2. Check generated markdown files in `output/` directory
3. Identify quality issues (missing content, poor structure)
4. Review debug logs in `output/debug_output_[timestamp]/`
5. Trace problems through the pipeline