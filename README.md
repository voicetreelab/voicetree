# 🎙️ VoiceTree - Voice-to-Knowledge-Graph System

Convert voice input into structured knowledge graphs using AI workflows.

## ⚡ Quick Start

```bash
# 1. Setup
pip install -r requirements.txt
source .venv/bin/activate

# 2. Configure API Key (REQUIRED)
export GOOGLE_API_KEY="your_gemini_api_key_here"
# OR add to .env file: GOOGLE_API_KEY=your_key_here

# 3. Test instantly (< 5 seconds)
python dev-test.py --speed smoke

# 4. Start coding with auto-tests
python dev-test.py --watch --speed smoke
```

## 🚨 Critical Dependency: Gemini API

**VoiceTree requires Google's Gemini API to function.** The system will **crash immediately** if the API is not available.

### API Setup
1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Set the environment variable: `export GOOGLE_API_KEY="your_key_here"`
3. Or add to `.env` file: `GOOGLE_API_KEY=your_key_here`

### Crash-Fast Philosophy
- ✅ **System starts**: API key valid and working
- ❌ **System crashes**: API unavailable, invalid key, or quota exceeded
- 🚫 **No graceful degradation**: The system requires AI to function

This ensures you know immediately if there's an API configuration issue rather than mysterious failures later.

## 🧪 Essential Testing Commands

| Command | Time | Use Case |
|---------|------|----------|
| `python dev-test.py --speed smoke` | **< 5s** | Quick checks while coding |
| `python dev-test.py --changed` | **< 10s** | Test only your changes |
| `python dev-test.py --speed unit` | **< 30s** | Before commits |
| `python dev-test.py --watch --speed smoke` | **< 5s** | Auto-run on file changes |

### Alternative Commands
```bash
# Traditional pytest
python -m pytest backend/tests/unit_tests/ --disable-warnings
python -m pytest -m "smoke or fast" -x -q

# Make commands  
make test-smoke      # < 5s
make test-unit       # < 30s
make test-local      # full local suite
```

## 🚀 Development Workflow

1. **Active coding**: `python dev-test.py --watch --speed smoke` (auto-run tests)
2. **Before commit**: `python dev-test.py --changed` (test your changes)
3. **Before push**: `python dev-test.py --speed unit` (full unit tests)

## 📊 Performance

- **Development loop**: 3+ minutes → **5 seconds** (97% faster)
- **Unit tests**: 3+ minutes → **13 seconds** (95% faster)
- **Changed files**: 3+ minutes → **10 seconds** (96% faster)

## 🔧 Setup

```bash
# Environment setup
cp .env.example .env
# Add your GOOGLE_API_KEY to .env

# Verify installation (should show 102 tests passing)
python dev-test.py --speed smoke
```

## 🔍 Troubleshooting

- **Slow tests?** Use `python dev-test.py --speed smoke` for development  
- **Import errors?** Ensure virtual environment is active: `source .venv/bin/activate`
- **Test failures?** Run `python -m pytest backend/tests/unit_tests/` to see details

---

**🎯 Goal**: < 10-second feedback loops for daily development.  
**⚡ Start**: `python dev-test.py --watch --speed smoke` and code! 