# PyCharm Setup for VoiceTree Agentic Workflows

This guide helps you set up PyCharm to run the VoiceTree agentic workflow tests efficiently.

## 🏃 Quick Setup

### 1. Configure Python Interpreter
1. Go to **Settings** → **Project** → **Python Interpreter**
2. Add your VoiceTree virtual environment (`.venv/bin/python`)
3. Ensure `pytest`, `pytest-asyncio`, and other dependencies are installed

### 2. Configure Test Runner
1. Go to **Settings** → **Tools** → **Python Integrated Tools**
2. Set **Default test runner** to `pytest`
3. Set **Working directory** to project root

## 🧪 Test Run Configurations

### Unit Tests (Fast Development)
- **Configuration Name**: "Unit Tests"
- **Target**: `backend/tests/unit_tests/`
- **Additional Arguments**: `--disable-warnings -v`
- **Environment Variables**: None required
- **Working Directory**: Project root

### Local Integration Tests
- **Configuration Name**: "Integration Tests (Local)"
- **Target**: `backend/tests/integration_tests/agentic_workflows/`
- **Additional Arguments**: `--test-mode=local -v`
- **Environment Variables**: `GOOGLE_API_KEY=your_api_key`
- **Working Directory**: Project root

### CI Integration Tests
- **Configuration Name**: "Integration Tests (CI)"
- **Target**: `backend/tests/integration_tests/agentic_workflows/`
- **Additional Arguments**: `--test-mode=ci -v`
- **Environment Variables**: `GOOGLE_API_KEY=your_api_key`
- **Working Directory**: Project root

## 🔧 Environment Setup

### Required Environment Variables
Create a `.env` file in your project root:
```bash
GOOGLE_API_KEY=your_api_key_here
```

### PyCharm Environment Configuration
1. Go to **Run** → **Edit Configurations**
2. For each test configuration, add environment variables:
   - `GOOGLE_API_KEY`: Your API key
   - `PYTEST_TEST_MODE`: `local` or `ci`

## 🚀 Development Workflow

### Daily Development
1. **Write code** → Run "Unit Tests" (fast feedback)
2. **Before commit** → Run "Integration Tests (Local)" (limited API calls)
3. **Full validation** → Run "Integration Tests (CI)" (comprehensive)

### Debugging
- Use PyCharm's built-in debugger with pytest configurations
- Set breakpoints in test files or source code
- Use "Debug" instead of "Run" for test configurations

## 📊 Performance Tips

| Test Type | Speed | Use Case |
|-----------|-------|----------|
| Unit Tests | ~10s | Daily development |
| Local Integration | ~25s | Pre-commit validation |
| CI Integration | ~60s | Full system validation |

## 🛠️ Common Issues

### Import Errors
- Ensure working directory is set to project root
- Verify Python interpreter is using the correct virtual environment

### API Key Issues
- Check `.env` file exists and contains `GOOGLE_API_KEY`
- Verify environment variables are set in run configuration

### Test Discovery Issues
- Ensure pytest is selected as test runner
- Check that test files follow `test_*.py` naming convention

## 🎯 Best Practices

- Use **unit tests** for rapid development iteration
- Use **local mode** for integration validation with limited API costs
- Use **CI mode** only for comprehensive validation
- Set up keyboard shortcuts for frequent test configurations 