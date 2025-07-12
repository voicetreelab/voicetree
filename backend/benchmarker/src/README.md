# Quality Benchmarking Module

This module provides a clean, modular approach to benchmarking the quality of VoiceTree's output using LLM evaluation.

```

## Usage

Run the benchmarker using either:

```bash
# From project root
python backend/benchmarker/quality_LLM_benchmarker.py

# Or as a module
python -m backend.benchmarker.src.quality_LLM_benchmarker
```

## Module Descriptions

### config.py
- Contains all configuration constants
- API rate limits, directories, file names
- Default test transcripts

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