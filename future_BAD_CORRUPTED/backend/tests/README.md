# Backend Test Organization

## Current Structure

```
backend/
├── tests/                          # Main test directory
│   ├── unit_tests/                 # Unit tests for individual components
│   │   ├── test_contextual_tree_manager.py
│   │   ├── test_workflow_adapter.py
│   │   └── ...
│   ├── integration_tests/          # Integration tests across modules
│   │   ├── test_reproduction_issues.py
│   │   ├── mocked/                 # Tests with mocked dependencies
│   │   └── live_system/            # Tests with real API calls
│   └── conftest.py                 # Shared test configuration
├── agentic_workflows/
│   ├── tests/                      # ❌ DEPRECATED - Should be moved
│   │   ├── test_pipeline.py        # → integration_tests/agentic/
│   │   ├── test_chunk_boundaries.py
│   │   └── ...
│   └── ...
└── ...
```

## Recommended Structure

```
backend/
├── tests/
│   ├── unit_tests/                 # Fast, isolated tests
│   │   ├── agentic_workflows/      # Unit tests for agentic components
│   │   │   ├── test_llm_integration.py
│   │   │   ├── test_schema_models.py
│   │   │   ├── test_prompt_engine.py
│   │   │   └── test_nodes.py
│   │   ├── tree_manager/
│   │   └── ...
│   ├── integration_tests/          # Cross-module tests
│   │   ├── agentic_workflows/      # Agentic workflow integration tests
│   │   │   ├── test_pipeline.py
│   │   │   ├── test_chunk_boundaries.py
│   │   │   ├── test_state_persistence.py
│   │   │   └── test_real_examples.py
│   │   ├── mocked/
│   │   ├── live_system/
│   │   └── test_reproduction_issues.py
│   └── conftest.py
└── agentic_workflows/              # No tests directory here
    ├── main.py
    ├── nodes.py
    └── ...
```

## Benefits of New Structure

1. **Clear separation** - Unit vs Integration tests
2. **Consistent imports** - All tests use same import patterns
3. **Better discovery** - pytest finds all tests automatically
4. **Module organization** - Tests grouped by the modules they test
5. **Easier maintenance** - One place to look for all tests

## Migration Plan

### Phase 1: Move Agentic Workflow Tests
- [x] Move `agentic_workflows/tests/` → `tests/integration_tests/agentic_workflows/`
- [x] Fix import paths in moved tests
- [x] Update test runners (`run_agentic_tests.py`)

### Phase 2: Add Unit Tests
- [x] Create unit tests for individual agentic workflow components
- [x] Add tests for prompt engine (`test_prompt_engine.py`)
- [ ] Add tests for schema validation
- [ ] Add tests for LLM integration
- [ ] Add tests for nodes module

### Phase 3: Cleanup
- [ ] Remove old `agentic_workflows/tests/` directory
- [ ] Update documentation
- [ ] Update CI/CD pipelines

## Running Tests

```bash
# All tests
pytest backend/tests/

# Unit tests only (fast)
pytest backend/tests/unit_tests/

# Integration tests only
pytest backend/tests/integration_tests/

# Specific module tests
pytest backend/tests/unit_tests/agentic_workflows/
pytest backend/tests/integration_tests/agentic_workflows/

# Current reproduction issues tests
pytest backend/tests/integration_tests/test_reproduction_issues.py
```

## Test Categories

### Unit Tests
- Test individual functions/classes in isolation
- Mock external dependencies
- Fast execution (< 1 second each)
- No API calls or file I/O

### Integration Tests
- Test multiple components working together
- May use real or mocked APIs
- Slower execution (seconds to minutes)
- Test end-to-end workflows

### Live System Tests
- Test against real APIs
- Require API keys and network access
- Slowest execution
- Used for final validation 