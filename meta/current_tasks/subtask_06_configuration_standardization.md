# Subtask: Configuration Standardization and Path Fixes

## Overview
Multiple configuration issues exist across the codebase, including confusing import paths, inconsistent output directories, and unclear configuration defaults. This task aims to standardize all configuration and make the system easier to understand and maintain.

## Current State Analysis

### Configuration Issues
1. **Voice Module Import Path**
   - File: `backend/settings.py:24`
   - TODO: "Fix the voice-to-text module import path"
   - Current: `voice_to_text.voice_to_text` (redundant)
   - Impact: Confusing module structure

2. **Output Directory Standardization**
   - File: `backend/settings.py:37`
   - TODO: "update to shared directory: unified_benchmark_reports"
   - Current: Multiple output directories used
   - Impact: Scattered outputs, hard to find results

3. **Execution Type Confusion**
   - File: `backend/settings.py:95`
   - TODO: Clarify default execution type
   - Related to STREAMING/ATOMIC mode confusion

4. **Absolute vs Relative Paths**
   - File: `backend/enhanced_transcription_processor.py:42`
   - TODO: Make output directory relative (not absolute)
   - Impact: Portability issues

5. **Infrastructure Executor Confusion**
   - File: `backend/agentic_workflows/infrastructure_executor.py`
   - Multiple "What is correct?" comments at lines 50, 119, 138, 148
   - Impact: Developer confusion about proper configuration

## Implementation Plan

### Phase 1: Configuration Audit (Day 1)
- [ ] Map all configuration points in the system
- [ ] Document current configuration flow
- [ ] Identify all hardcoded paths and values
- [ ] Create configuration dependency map

### Phase 2: Centralize Configuration (Day 2)
- [ ] Create unified configuration system
- [ ] Move all settings to central location
- [ ] Implement environment variable support
- [ ] Add configuration validation

### Phase 3: Fix Import Paths (Day 3)
- [ ] Restructure voice_to_text module
- [ ] Update all imports
- [ ] Clean up module __init__ files
- [ ] Test import resolution

### Phase 4: Standardize Output Paths (Day 4)
- [ ] Define standard output directory structure
- [ ] Update all components to use standard paths
- [ ] Make paths relative to project root
- [ ] Add path utilities

## Technical Approach

### Unified Configuration System
```python
# backend/config.py - New centralized configuration
from pathlib import Path
from typing import Optional
from pydantic import BaseSettings, validator
import os

class VoiceTreeConfig(BaseSettings):
    """Centralized configuration for VoiceTree system"""
    
    # Project paths
    PROJECT_ROOT: Path = Path(__file__).parent.parent
    OUTPUT_DIR: Path = PROJECT_ROOT / "unified_benchmark_reports"
    VAULT_DIR: Path = PROJECT_ROOT / "markdownTreeVault"
    DEBUG_DIR: Path = PROJECT_ROOT / "debug_output"
    
    # Voice to text configuration
    VOICE_MODULE: str = "backend.voice_to_text"
    VOICE_CLASS: str = "VoiceToText"
    
    # Execution configuration
    EXECUTION_MODE: str = "STREAMING"  # Single mode after cleanup
    BUFFER_SIZE: int = 1024
    PROCESSING_TIMEOUT: int = 300
    
    # LLM configuration
    GOOGLE_API_KEY: str
    LLM_MODEL: str = "gemini-1.5-flash"
    MAX_RETRIES: int = 3
    
    # Output configuration
    MARKDOWN_EXTENSION: str = ".md"
    LOG_LEVEL: str = "INFO"
    ENABLE_DEBUG_OUTPUT: bool = False
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    @validator("OUTPUT_DIR", "VAULT_DIR", "DEBUG_DIR", pre=True)
    def create_directories(cls, v):
        """Ensure directories exist"""
        path = Path(v)
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    @validator("GOOGLE_API_KEY")
    def validate_api_key(cls, v):
        if not v:
            raise ValueError("GOOGLE_API_KEY must be set")
        return v

# Singleton instance
config = VoiceTreeConfig()
```

### Path Utilities
```python
# backend/utils/paths.py
from pathlib import Path
from typing import Union
from backend.config import config

class PathManager:
    """Manages all path operations for VoiceTree"""
    
    @staticmethod
    def get_output_path(filename: str, subdir: Optional[str] = None) -> Path:
        """Get standardized output path"""
        base = config.OUTPUT_DIR
        if subdir:
            base = base / subdir
            base.mkdir(parents=True, exist_ok=True)
        return base / filename
    
    @staticmethod
    def get_vault_path(tree_name: str) -> Path:
        """Get path for markdown vault files"""
        return config.VAULT_DIR / f"{tree_name}.md"
    
    @staticmethod
    def get_debug_path(filename: str) -> Path:
        """Get debug output path"""
        if not config.ENABLE_DEBUG_OUTPUT:
            return None
        return config.DEBUG_DIR / filename
    
    @staticmethod
    def make_relative(path: Union[str, Path]) -> Path:
        """Convert absolute path to relative"""
        path = Path(path)
        try:
            return path.relative_to(config.PROJECT_ROOT)
        except ValueError:
            # Path is not under project root
            return path
```

### Fix Voice Module Structure
```python
# Move from: backend/voice_to_text/voice_to_text.py
# To: backend/voice_to_text.py or backend/voice/transcriber.py

# Or update __init__.py to expose cleaner import
# backend/voice_to_text/__init__.py
from .voice_to_text import VoiceToText

__all__ = ['VoiceToText']

# Then import as:
from backend.voice_to_text import VoiceToText
```

### Update Settings.py
```python
# backend/settings.py - Simplified to use central config
from backend.config import config

# All settings now come from centralized config
PROJECT_ROOT = config.PROJECT_ROOT
OUTPUT_DIR = config.OUTPUT_DIR
VOICE_MODULE = config.VOICE_MODULE
EXECUTION_MODE = config.EXECUTION_MODE
# ... etc
```

### Fix Infrastructure Executor
```python
# backend/agentic_workflows/infrastructure_executor.py
# Replace all "What is correct?" sections with clear configuration

from backend.config import config

class InfrastructureExecutor:
    def __init__(self):
        # Clear, configured values instead of questions
        self.execution_mode = config.EXECUTION_MODE
        self.output_path = config.OUTPUT_DIR
        self.enable_debug = config.ENABLE_DEBUG_OUTPUT
```

## Complexities and Risks

### Technical Complexities
1. **Import Dependencies**: Changing paths might break imports
2. **Configuration Migration**: Existing configs need migration
3. **Environment Variables**: Different environments need different configs
4. **Backward Compatibility**: External scripts might use old paths

### Risks
1. **Breaking Changes**: Path changes could break deployments
2. **Lost Configuration**: Migration might miss some settings
3. **Performance**: Additional validation might slow startup
4. **Testing**: All tests need updated paths

### Mitigation Strategies
1. **Gradual Migration**: Use compatibility layer during transition
2. **Configuration Validation**: Validate all settings on startup
3. **Clear Documentation**: Document all configuration options
4. **Migration Script**: Automate config migration

## Testing Strategy

### Configuration Tests
```python
def test_configuration_loading():
    """Test configuration loads correctly"""
    from backend.config import config
    
    assert config.PROJECT_ROOT.exists()
    assert config.OUTPUT_DIR.exists()
    assert config.EXECUTION_MODE == "STREAMING"

def test_path_utilities():
    """Test path management"""
    from backend.utils.paths import PathManager
    
    output_path = PathManager.get_output_path("test.txt")
    assert output_path.parent == config.OUTPUT_DIR
    
    relative = PathManager.make_relative(output_path)
    assert not relative.is_absolute()
```

### Import Tests
```python
def test_voice_module_import():
    """Test cleaned up imports work"""
    from backend.voice_to_text import VoiceToText
    assert VoiceToText is not None
```

### Migration Tests
```python
def test_configuration_migration():
    """Test old configs migrate correctly"""
    old_settings = load_old_settings()
    new_config = migrate_to_new_config(old_settings)
    
    assert new_config.OUTPUT_DIR == expected_path
    assert new_config.VOICE_MODULE == "backend.voice_to_text"
```

## Migration Guide

### For Developers
1. **Update Imports**
   ```python
   # Old
   from backend.settings import OUTPUT_DIR
   
   # New
   from backend.config import config
   output_dir = config.OUTPUT_DIR
   ```

2. **Use Path Utilities**
   ```python
   # Old
   output_file = os.path.join(OUTPUT_DIR, "results.txt")
   
   # New
   from backend.utils.paths import PathManager
   output_file = PathManager.get_output_path("results.txt")
   ```

3. **Environment Variables**
   ```bash
   # .env file
   GOOGLE_API_KEY=your_key_here
   OUTPUT_DIR=./custom_output
   LOG_LEVEL=DEBUG
   ```

## Success Criteria

1. **Configuration Clarity**
   - Single source of truth for all settings
   - No hardcoded paths in code
   - Clear documentation for all options

2. **Path Consistency**
   - All outputs in unified directory
   - Relative paths for portability
   - Clean import structure

3. **Developer Experience**
   - No more "What is correct?" comments
   - Easy to understand configuration
   - Simple to add new settings

4. **Testing**
   - All tests pass with new configuration
   - Migration works smoothly
   - No regression in functionality

## Dependencies
- Should coordinate with STREAMING mode standardization
- Affects all components that use configuration

## Notes
- This standardization will significantly improve maintainability
- Consider using pydantic for configuration validation
- Environment-specific configs should be clearly documented
- Add configuration schema for IDE support