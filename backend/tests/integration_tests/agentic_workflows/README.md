# VoiceTree Agentic Workflows Testing

This directory contains tests for the agentic workflows with **multi-speed testing strategy** for optimal development experience.

## 🚀 Testing Modes

### ⚡ **Mocked Mode** (Instant ~5s)
- **Use case**: Quick development iteration, CI pre-checks
- **Speed**: ~5 seconds  
- **API calls**: 0 (all mocked)
- **Chunks tested**: 10 (comprehensive logic without API cost)

```bash
make test-mocked
# OR
pytest --test-mode=mocked -v
```

### 🏃 **Local Mode** (Fast ~25s)  
- **Use case**: Before committing, local validation
- **Speed**: ~25 seconds
- **API calls**: ~8 real API calls  
- **Chunks tested**: 2 (core functionality)

```bash
make test-local
# OR  
pytest --test-mode=local --api-calls -v
```

### 🐌 **CI Mode** (Comprehensive ~60s)
- **Use case**: CI/CD pipeline, full validation
- **Speed**: ~60 seconds
- **API calls**: ~20 real API calls
- **Chunks tested**: 5 (comprehensive coverage)

```bash
make test-ci
# OR
pytest --test-mode=ci --api-calls -v
```

## 📊 Performance Comparison

| Mode | Time | API Calls | Cost | Use Case |
|------|------|-----------|------|----------|
| **Mocked** | ~5s | 0 | $0 | Dev iteration |
| **Local** | ~25s | ~8 | ~$0.01 | Pre-commit |
| **CI** | ~60s | ~20 | ~$0.03 | Full validation |

## 🛡️ Safety Features

- **API Safety**: Tests require `--api-calls` flag to make real API calls
- **Auto-skipping**: Tests auto-skip without explicit permission
- **Environment check**: Validates API keys before running
- **Cost control**: Limited chunk counts prevent runaway costs

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
- **Chunk counts** per mode (local: 2, ci: 5, mocked: 10)
- **API safety** checks and flags
- **Test markers** for organization

## 🚨 Common Issues

### "GOOGLE_API_KEY not set"
```bash
# Make sure your .env file exists with:
GOOGLE_API_KEY=your_api_key_here

# Or export it manually:
export GOOGLE_API_KEY="your_api_key_here"
```

### "Skipping test that makes real API calls"
```bash
# Add the --api-calls flag:
pytest --test-mode=local --api-calls -v
```

### Tests taking too long
```bash
# Use mocked mode for development:
make test-mocked
```

## 🎯 Best Practices

### Development Workflow
1. **Write code** → `make test-mocked` (instant feedback)
2. **Before commit** → `make test-local` (quick validation) 
3. **CI/CD** → `make test-ci` (comprehensive)

### Cost Management
- Use **mocked mode** for 90% of development
- Use **local mode** only when needed
- **CI mode** runs automatically on main/develop branches

### Debugging
- Check `latest_quality_log.txt` for detailed test logs
- Use `-v` flag for verbose output
- Use `--tb=short` for concise error traces

## 🔄 CI/CD Integration

The GitHub Actions workflow (`.github/workflows/test-agentic-workflows.yml`) automatically:
- Runs **mocked tests** on all PRs (fast feedback)
- Runs **CI tests** on main/develop branches (comprehensive)
- Provides **performance benchmarks** on manual trigger

## 📈 Future Improvements

- [ ] Add performance regression detection
- [ ] Implement test result caching  
- [ ] Add more comprehensive mocking
- [ ] Create visual test reports
- [ ] Add integration with quality metrics 