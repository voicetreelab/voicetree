# Text Buffer Manager

Clean interface for managing text buffering and chunk processing in the VoiceTree system.

## Overview

The Text Buffer Manager handles:
- Adaptive text buffering strategy
- Incomplete chunk remainder management
- Transcript history tracking
- Sentence extraction and processing

## Components

### TextBufferManager
Main class that provides a clean interface for buffer management.

### BufferConfig
Configuration dataclass for customizing buffer behavior:
- `buffer_size_threshold`: Characters needed before processing
- `transcript_history_multiplier`: How much history to maintain
- `immediate_processing_size_multiplier`: Threshold multiplier for immediate processing
- `substantial_content_threshold`: Percentage of threshold for substantial content
- `min_sentences_for_immediate`: Minimum sentences to trigger immediate processing

### SentenceExtractor
Utility class for extracting complete sentences from text.

## Usage

```python
from text_buffer_manager import TextBufferManager, BufferConfig

# Create with custom config
config = BufferConfig(buffer_size_threshold=100)
manager = TextBufferManager(config=config)

# Add text and check if ready
result = manager.add_text("Some text input")
if result.is_ready:
    process(result.text)

# Handle incomplete remainders
manager.set_incomplete_remainder("Incomplete")

# Get transcript history for context
history = manager.get_transcript_history()
```

## Architecture Benefits

- **Clean Interface**: Hides complexity of buffer management
- **Adaptive Processing**: Automatically chooses between immediate and buffered processing
- **Testable**: Easy to unit test with clear inputs/outputs
- **Configurable**: Flexible configuration for different use cases