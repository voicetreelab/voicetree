# PyCharm IDE Setup for VoiceTree Tests

This guide shows how to run VoiceTree agentic workflow tests directly from PyCharm IDE.

## 🚀 Quick Setup

### Option 1: Environment Variables (Recommended)

Set these in your PyCharm run configuration:

```bash
# For mocked tests (fast, no API calls)
PYTEST_TEST_MODE=mocked

# For local tests with real API calls  
PYTEST_TEST_MODE=local
PYTEST_ALLOW_API_CALLS=true

# For comprehensive CI tests
PYTEST_TEST_MODE=ci
PYTEST_ALLOW_API_CALLS=true
```

### Option 2: PyCharm Run Configuration

1. **Right-click on a test file** → "Create 'pytest in test_...'..."
2. **In the configuration dialog:**
   - **Additional Arguments**: `--test-mode=mocked` (or `local`/`ci`)
   - **Additional Arguments**: `--api-calls` (if you want real API calls)

## 📋 Step-by-Step PyCharm Configuration

### 1. Create Run Configuration Templates

**For Mocked Tests (No API calls):**
- Name: `VoiceTree Mocked Tests`
- Target: `Custom`
- Additional arguments: `--test-mode=mocked`
- Environment variables: `PYTEST_TEST_MODE=mocked`

**For Local Tests (Real API calls):**
- Name: `VoiceTree Local Tests`  
- Target: `Custom`
- Additional arguments: `--test-mode=local --api-calls`
- Environment variables: `PYTEST_TEST_MODE=local;PYTEST_ALLOW_API_CALLS=true`

**For CI Tests (Full validation):**
- Name: `VoiceTree CI Tests`
- Target: `Custom` 
- Additional arguments: `--test-mode=ci --api-calls`
- Environment variables: `PYTEST_TEST_MODE=ci;PYTEST_ALLOW_API_CALLS=true`

### 2. Set Project Environment Variables

**File → Settings → Build, Execution, Deployment → Console → Python Console**

Add these environment variables:
```
PYTEST_TEST_MODE=mocked
PYTEST_ALLOW_API_CALLS=false
```

### 3. Configure Pytest as Default Runner

**File → Settings → Tools → Python Integrated Tools**
- **Default test runner**: `pytest`

## 🎯 Test Modes Explained

| Mode | Speed | API Calls | Use Case |
|------|-------|-----------|----------|
| **mocked** | ~5s | 0 | Daily development |
| **local** | ~25s | ~8 | Pre-commit validation |
| **ci** | ~60s | ~20 | Full validation |

## 🔧 Environment Variables Reference

```bash
# Test mode (default: local)
PYTEST_TEST_MODE=mocked|local|ci

# Allow real API calls (default: false)  
PYTEST_ALLOW_API_CALLS=true|false

# Google API key (required for real API calls)
GOOGLE_API_KEY=your_api_key_here
```

## 🚨 Common Issues & Solutions

### "Running in IDE without API calls enabled"
**Solution**: Set `PYTEST_ALLOW_API_CALLS=true` in environment variables

### "google.genai package not available"
**Solution**: Make sure your virtual environment is activated and has the package:
```bash
pip install google-genai
```

### "No option named 'api_calls'"
**Solution**: Update to the latest `conftest.py` (this should now be fixed)

### Tests are too slow
**Solution**: Use mocked mode: `PYTEST_TEST_MODE=mocked`

## 🎮 Running Different Test Types

### In PyCharm Test Runner

**Right-click any test and choose:**
- **Run**: Uses your environment variables/configuration
- **Debug**: Same as run but with debugging enabled

### From PyCharm Terminal

```bash
# Mocked tests (fast)
make test-mocked

# Local tests (real API calls)  
make test-local

# CI tests (comprehensive)
make test-ci
```

### Individual Test Files

**Right-click on specific test files:**
- `test_chunk_boundaries_adaptive.py` - Main adaptive tests
- `test_real_examples.py` - Real-world examples
- `test_chunk_boundaries.py` - Original comprehensive tests

## 🏆 Recommended PyCharm Workflow

1. **Daily development**: Use `PYTEST_TEST_MODE=mocked` as default
2. **Before committing**: Run specific tests with `local` mode  
3. **Debugging**: Use PyCharm debugger with `mocked` mode for speed
4. **Final validation**: Use `ci` mode before pushing

## 🔍 Debugging Tips

- **Set breakpoints** in mocked mode for fastest debugging
- **Use "Run with Coverage"** to see test coverage
- **Check console output** for detailed test progression
- **View test logs** in `latest_quality_log.txt`

Your tests should now work perfectly in PyCharm! 🎉 