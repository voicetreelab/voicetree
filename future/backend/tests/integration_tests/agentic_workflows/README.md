# VoiceTree Agentic Workflows Testing

This directory contains tests for the agentic workflows with **real integration testing strategy** for reliable development.

## 🚀 Testing Philosophy

**Integration tests should test real integration, not mocked behavior.**

To avoid API costs during development, use unit tests (`pytest backend/tests/unit_tests/`) for fast iteration, and integration tests only when you need to validate real API integration.

## 🧪 Testing Modes

### 🏃 **Local Mode** (Limited API ~25s)  
- **Use case**: Local development, before committing
- **Speed**: ~25 seconds
- **API calls**: Limited to reduce costs
- **Chunks tested**: 2 (core functionality)

```bash
make test-local
# OR  
pytest --test-mode=local -v
```

### 🐌 **CI Mode** (Comprehensive ~60s)
- **Use case**: CI/CD pipeline, full validation
- **Speed**: ~60 seconds
- **API calls**: Comprehensive testing
- **Chunks tested**: 5 (full coverage)

```bash
make test-ci
# OR
pytest --test-mode=ci -v
```

## ⚡ Fast Development Workflow

For rapid development feedback, use unit tests instead of integration tests:

```bash
# Fast feedback during development (< 10s)
make test-smoke

# Unit tests before committing (< 45s)  
make test-unit

# Integration tests only when needed
make test-local
```

## 📊 Performance Comparison

| Mode | Time | API Calls | Cost | Use Case |
|------|------|-----------|------|----------|
| **Unit Tests** | ~10s | 0 | $0 | Dev iteration |
| **Local** | ~25s | Limited | ~$0.01 | Pre-commit |
| **CI** | ~60s | Comprehensive | ~$0.03 | Full validation |

## 🛡️ Safety Features

- **API Safety**: Tests automatically manage API call volume based on mode
- **Environment check**: Validates API keys before running
- **Cost control**: Local mode has limited chunk counts
- **Fail fast**: System crashes immediately if API not configured (no confusing TypeErrors)

## 📁 Test Files

### Core Test Files
- **`test_chunk_boundaries_adaptive.py`** - Adaptive chunk boundary tests
- **`test_real_examples.py`** - Real-world usage examples  
- **`conftest.py`** - Pytest configuration and fixtures

### Legacy Files (Still Working)
- **`test_chunk_boundaries.py`** - Original full test (slow)
- **`test_chunk_boundaries_quick.py`** - Quick 2-chunk version
- **`test_chunk_boundaries_fast.py`** - Failed mocking attempt

## 🔧 Configuration

The testing system uses `conftest.py` to manage:
- **Chunk counts** per mode (local: limited, ci: comprehensive)
- **API call management** based on test mode
- **Test markers** for organization

## 🚨 Common Issues

### "GOOGLE_API_KEY not set"
```bash
# Make sure your .env file exists with:
GOOGLE_API_KEY=your_api_key_here

# Or export it manually:
export GOOGLE_API_KEY="your_api_key_here"
```

### Tests crashing with API errors
This is expected behavior! The system fails fast to provide clear error messages about API configuration issues rather than returning confusing None values.

### Tests taking too long
```bash
# Use unit tests for development instead:
make test-unit

# Only run integration tests when needed:
make test-local
```

## 🎯 Best Practices

### Development Workflow
1. **Write code** → `make test-unit` (fast unit tests)
2. **Before commit** → `make test-local` (limited integration) 
3. **CI/CD** → `make test-ci` (comprehensive integration)

### Cost Management
- Use **unit tests** for 90% of development
- Use **local mode** only when you need real API validation
- **CI mode** runs automatically on main/develop branches

### Debugging
- Check `latest_quality_log.txt` for detailed test logs
- Use `-v` flag for verbose output
- Use `--tb=short` for concise error traces

## 🔄 CI/CD Integration

The GitHub Actions workflow (`.github/workflows/test-agentic-workflows.yml`) automatically:
- Runs **unit tests** on all PRs (fastest feedback)
- Runs **integration tests** (no API) on all PRs  
- Runs **API integration tests** on main/develop branches (comprehensive)
- Provides **performance benchmarks** on manual trigger

## 📈 Current Architecture

- **PYTEST_TEST_MODE**: `local` or `ci` (controls API call volume)
- **No mocking**: Integration tests always use real APIs for authentic validation
- **Fast feedback**: Unit tests provide rapid development iteration
- **Cost control**: Local mode limits API usage, CI mode is comprehensive

## 🎯 Migration Notes

- **Removed**: `mocked` test mode (integration tests should test real integration)
- **Removed**: `PYTEST_ALLOW_API_CALLS` flag (integration tests always use APIs)
- **Added**: Clear fail-fast behavior when API not configured
- **Philosophy**: Unit tests for speed, integration tests for real validation

## 📈 Future Improvements

- [ ] Add performance regression detection
- [ ] Implement test result caching  
- [ ] Add more comprehensive mocking
- [ ] Create visual test reports
- [ ] Add integration with quality metrics 