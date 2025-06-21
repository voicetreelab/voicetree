# Quality Benchmarking Module

This module provides a clean, modular approach to benchmarking the quality of VoiceTree's output using LLM evaluation.

## Structure

```
quality_tests/
├── __init__.py              # Package initialization
├── config.py                # Configuration settings
├── file_utils.py            # File and directory operations
├── transcript_processor.py  # Transcript processing logic
├── evaluation_prompts.py    # Evaluation prompts and criteria
├── evaluator.py            # LLM-based quality evaluation
└── quality_LLM_benchmarker.py  # Main orchestration
```

## Usage

Run the benchmarker using either:

```bash
# From project root
python backend/benchmarker/quality_LLM_benchmarker.py

# Or as a module
python -m backend.benchmarker.quality_tests.quality_LLM_benchmarker
```

## Module Descriptions

### config.py
- Contains all configuration constants
- API rate limits, directories, file names
- Default test transcripts

### file_utils.py
- Output directory setup and backup
- Git information retrieval
- Run context saving
- Workflow log management

### transcript_processor.py
- `TranscriptProcessor` class handles transcript processing
- Manages VoiceTree pipeline initialization
- Chunks transcripts into coherent segments
- Handles rate limiting and state management

### evaluation_prompts.py
- Separated evaluation criteria and prompts
- Modular prompt building function
- Easy to modify evaluation criteria

### evaluator.py
- `QualityEvaluator` class for LLM-based evaluation
- Loads workflow prompts
- Packages output for evaluation
- Manages logging of results

### quality_LLM_benchmarker.py
- Simple main orchestration
- Clean async interface
- Minimal complexity

## Customization

To add new test transcripts, modify `DEFAULT_TEST_TRANSCRIPTS` in `config.py`:

```python
DEFAULT_TEST_TRANSCRIPTS = [
    {
        "file": "path/to/transcript.txt",
        "name": "Display Name",
        "max_words": 150  # Optional word limit
    }
]
```

## Benefits of Refactoring

1. **Separation of Concerns**: Each module has a single, clear responsibility
2. **Testability**: Individual components can be unit tested
3. **Maintainability**: Easy to modify or extend specific functionality
4. **Readability**: Clear structure makes the codebase easier to understand
5. **Reusability**: Components can be used independently