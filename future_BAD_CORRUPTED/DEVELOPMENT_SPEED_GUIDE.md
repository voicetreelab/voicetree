# VoiceTree Development Guide

## Overview
This guide shows you how to run tests efficiently during development. Instead of running the full 3+ minute test suite, you can get feedback in under 30 seconds.

## Quick Commands

### Fast Tests (under 5 seconds)
```bash
# Smoke tests for critical functionality
python dev-test.py --speed smoke

# Or directly with pytest
python -m pytest -m "smoke or fast" --tb=short -x --disable-warnings -q
```

### Unit Tests Only (under 15 seconds)
```bash
# Run just unit tests
python -m pytest backend/tests/unit_tests/ --tb=short --disable-warnings

# Using the dev script
python dev-test.py --speed fast
```

### Test Only Your Changes (under 10 seconds)
```bash
# Tests related to files you've modified
python dev-test.py --changed
```

## Test Categories

Tests are organized with pytest markers:

- `@pytest.mark.fast` - Quick tests (under 1 second)
- `@pytest.mark.slow` - Longer tests (over 5 seconds)  
- `@pytest.mark.smoke` - Critical functionality
- `@pytest.mark.unit` - Pure unit tests
- `@pytest.mark.integration` - Integration tests
- `@pytest.mark.api` - Real API calls
- `@pytest.mark.mock` - Mocked services

### Using Markers
```bash
# Run only fast tests
python -m pytest -m fast

# Skip slow tests
python -m pytest -m "not slow"

# Combine markers
python -m pytest -m "fast and unit"
```

## Continuous Testing

Auto-run tests when files change:
```bash
# Watch mode with dev script
python dev-test.py --watch --speed smoke

# Traditional pytest-watch
ptw -- --tb=short -x --disable-warnings -q
```

## Development Workflow

### Active Development
```bash
# Start watch mode for instant feedback
python dev-test.py --watch --speed smoke
```

### Before Committing
```bash
# Run unit tests to catch issues
python dev-test.py --speed unit

# Or test only your changes
python dev-test.py --changed
```

### Before Pushing
```bash
# Full unit test suite
python dev-test.py --speed unit
```

## Performance Comparison

| Test Type | Old Method | New Method | Time Saved |
|-----------|------------|------------|------------|
| Smoke Tests | 3+ minutes | 5 seconds | 97% faster |
| Unit Tests | 3+ minutes | 15 seconds | 95% faster |
| Changed Files | 3+ minutes | 10 seconds | 96% faster |

## Available Commands

### Make Commands
```bash
make test-smoke      # Quick critical tests
make test-fast       # Fast tests only  
make test-unit       # Unit tests only
make test-watch      # Continuous testing
```

### Dev Script Options
```bash
python dev-test.py --speed smoke    # Fastest tests
python dev-test.py --speed fast     # Fast tests
python dev-test.py --speed unit     # Unit test suite
python dev-test.py --changed        # Test your changes
python dev-test.py --watch          # Auto-run on changes
```

## Best Practices

### Testing Strategy
- **Development**: Use smoke tests (under 10 seconds)
- **Pre-commit**: Use unit tests (under 30 seconds)  
- **Pre-push**: Use integration tests (under 2 minutes)
- **CI/CD**: Full test suite

### Test Organization
- Mark new tests with appropriate speed markers
- Keep unit tests isolated and fast
- Use mocks for external dependencies in fast tests

### Smart Test Selection
- Use `--changed` when working on specific features
- Use watch mode during active development
- Run full suite only before major commits

## Troubleshooting

### Tests running too slowly?
- Check if they need `@pytest.mark.slow` marker
- Look for unnecessary API calls or file operations
- Consider adding mocks for external dependencies

### Watch mode not working?
- Install pytest-watch: `pip install pytest-watch`
- Check file permissions on `dev-test.py`
- Verify git is initialized in the project

### Getting test failures?
- Run tests manually: `python dev-test.py --speed smoke`
- Check specific test output: `python -m pytest backend/tests/unit_tests/ -v`