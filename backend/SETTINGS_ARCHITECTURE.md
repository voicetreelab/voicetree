# Settings Architecture Comparison

## Current Approach (Centralized)
All settings in one `settings.py` file.

**Pros:**
- Single file to check for all settings
- Easy to see all configuration at once
- Simple to override for different environments

**Cons:**
- Becomes a dumping ground for unrelated settings
- No clear ownership or context
- Hard to understand which settings belong to which module
- Circular import risks when modules need settings

## Proposed Approach (Hybrid)

### Structure:
1. **Module-specific config classes** (e.g., `BufferConfig`, `VoiceConfig`)
   - Located near where they're used
   - Include validation and defaults
   - Self-documenting with type hints

2. **Central settings.py**
   - Imports module configs
   - Handles environment variables
   - Provides backward compatibility
   - Single place for deployment configuration

### Benefits:

1. **Better Cohesion**
   - Settings live with the code that uses them
   - Clear ownership and context

2. **Type Safety**
   - Config classes with validation
   - IDE autocomplete and type checking

3. **Testability**
   ```python
   # Easy to test with different configs
   test_config = BufferConfig(buffer_size_threshold=10)
   manager = TextBufferManager(config=test_config)
   ```

4. **Flexibility**
   - Can still override via environment variables
   - Easy to create custom configs for testing
   - No circular imports

5. **Documentation**
   - Config classes serve as documentation
   - Clear what settings are available for each module

## Migration Path

1. Keep existing `settings.py` for backward compatibility
2. Gradually move settings to module configs
3. Update imports to use new configs
4. Eventually deprecate old settings.py

## Example Usage

```python
# Old way
from settings import TEXT_BUFFER_SIZE_THRESHOLD
manager = TextBufferManager(buffer_size_threshold=TEXT_BUFFER_SIZE_THRESHOLD)

# New way
from text_buffer_manager import TextBufferManager, BufferConfig
manager = TextBufferManager()  # Uses default config
# or
custom_config = BufferConfig(buffer_size_threshold=100)
manager = TextBufferManager(config=custom_config)
```