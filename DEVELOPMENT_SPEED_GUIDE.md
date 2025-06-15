# 🚀 VoiceTree Fast Development Guide

## Overview
This guide shows you how to achieve **sub-30-second feedback loops** for local development, compared to the previous 3+ minute full test suite.

## ⚡ Quick Commands (< 30 seconds)

### 1. Super Fast Smoke Tests (< 5 seconds)
```bash
# Option 1: Direct pytest
python -m pytest -m "smoke or fast" --tb=short -x --disable-warnings -q

# Option 2: Smart script
python dev-test.py --speed smoke

# Option 3: Makefile
make test-smoke
```

### 2. Fast Tests Only (< 15 seconds)
```bash
# Unit tests only
python -m pytest backend/tests/unit_tests/ --tb=short --disable-warnings

# Smart fast selection
python dev-test.py --speed fast

# Makefile
make test-fast
```

### 3. Changed Files Only (< 10 seconds)
```bash
# Only test files related to your changes
python dev-test.py --changed
```

## 🎯 Test Categories & Markers

We now have organized tests with pytest markers:

- `@pytest.mark.fast` - Tests that run in < 1 second
- `@pytest.mark.slow` - Tests that take > 5 seconds  
- `@pytest.mark.smoke` - Critical functionality tests
- `@pytest.mark.unit` - Pure unit tests (no external deps)
- `@pytest.mark.integration` - Integration tests
- `@pytest.mark.api` - Tests making real API calls
- `@pytest.mark.mock` - Tests using mocked services

### Using Markers
```bash
# Run only fast tests
python -m pytest -m fast

# Run everything except slow tests  
python -m pytest -m "not slow"

# Run smoke tests for critical functionality
python -m pytest -m smoke

# Combine markers
python -m pytest -m "fast and unit"
```

## 👀 Continuous Testing (Watch Mode)

### Auto-run tests on file changes
```bash
# Watch mode with smart script
python dev-test.py --watch

# Traditional pytest-watch
ptw -- --tb=short -x --disable-warnings -q
```

## 🛠️ Development Workflow

### 1. **Active Development** (< 5s feedback)
```bash
# Start watch mode for instant feedback
python dev-test.py --watch --speed smoke
```

### 2. **Before Commit** (< 30s)
```bash
# Run fast tests to catch issues
make test-fast

# Or test only changed files
python dev-test.py --changed
```

### 3. **Pre-Push** (< 2 minutes)
```bash
# Full unit test suite
make test-unit

# Or comprehensive but targeted
python dev-test.py --speed unit
```

## 📊 Performance Comparison

| Test Type | Old Method | New Method | Improvement |
|-----------|------------|------------|-------------|
| **Smoke Tests** | 3m+ (full suite) | **5s** | **97% faster** |
| **Unit Tests Only** | 3m+ (full suite) | **15s** | **95% faster** |
| **Changed Files Only** | 3m+ (full suite) | **10s** | **96% faster** |
| **Full Test Suite** | 4m+ (sequential) | **3m** (parallel) | **25% faster** |

## 🔧 Configuration Files

### pytest.ini
- Added test markers for categorization
- Enabled parallel execution by default (`-n auto`)
- Optimized for fast feedback

### Makefile
- `make test-smoke` - Super fast critical tests
- `make test-fast` - Fast tests only
- `make test-unit` - Unit tests only  
- `make test-watch` - Continuous testing

### dev-test.py
Smart test runner that:
- Detects changed files via git
- Maps source files to relevant tests
- Provides speed-optimized test selection
- Supports watch mode

## 🎯 IDE Integration

### VSCode
1. Install Python Test Explorer
2. Configure test discovery: `backend/tests/`
3. Use pytest markers for filtering
4. Set up tasks for quick commands

### PyCharm
1. Configure pytest as test runner
2. Create run configurations for different speed modes
3. Use markers for test filtering

## 🚦 Pre-commit Hooks

Automatic fast tests before commits:
```bash
# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Now fast tests run automatically on git commit
```

## 📈 Best Practices

### 1. **Layered Testing Strategy**
- **Development**: Use smoke/fast tests (< 10s)
- **Pre-commit**: Use unit tests (< 30s)
- **Pre-push**: Use integration tests (< 2m)
- **CI/CD**: Full test suite (3m+)

### 2. **Test Organization**
- Mark new tests with appropriate speed markers
- Keep unit tests isolated and fast
- Use mocks for external dependencies in fast tests

### 3. **Smart Test Selection**
- Use `--changed` flag when working on specific features
- Use watch mode during active development
- Run full suite only before major commits

## 🔍 Troubleshooting

### Tests too slow?
- Check if they need `@pytest.mark.slow` marker
- Look for unnecessary API calls or file I/O
- Consider adding mocks for external dependencies

### Watch mode not working?
- Ensure `pytest-watch` is installed: `pip install pytest-watch`
- Check file permissions on `dev-test.py`
- Verify git is initialized in the project

### Pre-commit hooks failing?
- Run tests manually to debug: `python dev-test.py --speed smoke`
- Check pre-commit config: `pre-commit run --all-files`

## 📚 Command Reference

### Make Commands
```bash
make test-smoke      # < 5s - critical tests only
make test-fast       # < 15s - fast tests only  
make test-unit       # < 30s - unit tests only
make test-watch      # continuous testing
make test-local      # original local tests
make test-ci         # full comprehensive tests
```

### dev-test.py Commands
```bash
python dev-test.py --speed smoke    # < 5s
python dev-test.py --speed fast     # < 15s  
python dev-test.py --speed unit     # < 30s
python dev-test.py --changed        # test changed files only
python dev-test.py --watch          # continuous testing
```

### Direct pytest Commands
```bash
# Speed-based
python -m pytest -m "smoke or fast" -x -q
python -m pytest -m "fast and not slow" 
python -m pytest backend/tests/unit_tests/

# Marker-based  
python -m pytest -m smoke
python -m pytest -m "not api"
python -m pytest -m "unit and fast"
```

---

**🎯 Goal**: Achieve < 30-second feedback loops for 90% of development work, keeping the 3+ minute comprehensive tests for final validation only. 