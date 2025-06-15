# VoiceTree Testing Makefile
# Make it easy to run different test modes

.PHONY: help test-mocked test-local test-ci test-all clean test-smoke test-fast test-unit test-watch

help:
	@echo "🧪 VoiceTree Testing Commands"
	@echo "=========================="
	@echo ""
	@echo "🚀 Fast Feedback (< 30s):"
	@echo "  test-smoke     - ⚡ Critical smoke tests only (< 10s)"
	@echo "  test-fast      - ⚡ Fast tests only (< 30s)"
	@echo "  test-unit      - 🏃 Unit tests only (< 45s)"
	@echo "  test-watch     - 👀 Watch mode - auto-run tests on changes"
	@echo ""
	@echo "🧪 Full Test Modes:"
	@echo "  test-mocked    - ⚡ Super fast tests (mocked LLM calls, ~5s)"
	@echo "  test-local     - 🏃 Fast tests (2 chunks, real API, ~25s)"
	@echo "  test-ci        - 🐌 Comprehensive tests (5 chunks, real API, ~60s)"
	@echo "  test-all       - 🔄 Run all test modes in sequence"
	@echo ""
	@echo "Utilities:"
	@echo "  clean         - 🧹 Clean up test artifacts"
	@echo "  requirements  - 📦 Install/update dependencies"
	@echo ""
	@echo "Examples:"
	@echo "  make test-smoke     # Super quick smoke test (< 10s)"
	@echo "  make test-fast      # Quick dev testing (< 30s)" 
	@echo "  make test-unit      # Before committing (< 45s)"

# New fast feedback commands
test-smoke:
	@echo "💨 Running smoke tests (< 10s)..."
	@time python -m pytest -m "smoke or fast" --tb=short -x --disable-warnings -q

test-fast:
	@echo "⚡ Running fast tests (< 30s)..."
	@time python -m pytest -m "fast or (unit and not slow)" --tb=short --disable-warnings

test-unit:
	@echo "🏃 Running unit tests (< 45s)..."
	@time python -m pytest tests/unit_tests/ --tb=short --disable-warnings

test-watch:
	@echo "👀 Starting watch mode - tests will run on file changes..."
	@echo "💡 Install: pip install pytest-watch"
	@command -v ptw >/dev/null 2>&1 || { echo "Installing pytest-watch..."; pip install pytest-watch; }
	@ptw --runner "python -m pytest -m fast --tb=short -x --disable-warnings -q"

# Original test commands
test-mocked:
	@echo "🚀 Running mocked tests (instant)..."
	cd backend/tests/integration_tests/agentic_workflows && \
	python -m pytest test_chunk_boundaries_adaptive.py test_real_examples.py \
		--test-mode=mocked \
		-v

test-local:
	@echo "🏃 Running local tests (2 chunks, ~25s)..."
	@echo "💡 Tip: Make sure your .env file has GOOGLE_API_KEY set"
	cd backend/tests/integration_tests/agentic_workflows && \
	python -m pytest test_chunk_boundaries_adaptive.py test_real_examples.py \
		--test-mode=local \
		--api-calls \
		-v

test-ci:
	@echo "🐌 Running CI tests (5 chunks, ~60s)..."
	@echo "💡 Tip: This makes real API calls and takes time"
	cd backend/tests/integration_tests/agentic_workflows && \
	python -m pytest test_chunk_boundaries_adaptive.py test_real_examples.py \
		--test-mode=ci \
		--api-calls \
		-v

test-all:
	@echo "🔄 Running all test modes..."
	@echo ""
	@make test-mocked
	@echo ""
	@make test-local
	@echo ""
	@make test-ci
	@echo ""
	@echo "✅ All test modes completed!"

clean:
	@echo "🧹 Cleaning up test artifacts..."
	find . -name "*_state.json" -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete
	find . -name ".pytest_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	@echo "✅ Cleanup complete!"

requirements:
	@echo "📦 Installing/updating dependencies..."
	pip install -r requirements.txt
	pip install pytest pytest-asyncio pytest-xdist pytest-watch
	@echo "✅ Dependencies updated!"

# Performance comparison
benchmark:
	@echo "📊 Running performance benchmarks..."
	@echo ""
	@echo "🚀 Mocked (baseline):"
	@time -p cd backend/tests/integration_tests/agentic_workflows && \
		python -m pytest test_chunk_boundaries_adaptive.py::test_chunk_boundaries_adaptive \
		--test-mode=mocked -v -q 2>/dev/null || true
	@echo ""
	@echo "🏃 Local mode (2 chunks):"
	@time -p cd backend/tests/integration_tests/agentic_workflows && \
		python -m pytest test_chunk_boundaries_adaptive.py::test_chunk_boundaries_adaptive \
		--test-mode=local --api-calls -v -q 2>/dev/null || true
	@echo ""
	@echo "🐌 CI mode (5 chunks):"
	@time -p cd backend/tests/integration_tests/agentic_workflows && \
		python -m pytest test_chunk_boundaries_adaptive.py::test_chunk_boundaries_adaptive \
		--test-mode=ci --api-calls -v -q 2>/dev/null || true

# Quick status check
status:
	@echo "🔍 VoiceTree Test Status"
	@echo "======================="
	@echo ""
	@echo "Python version: $(shell python --version)"
	@echo "Working directory: $(shell pwd)"
	@echo "Virtual environment: $(shell echo $$VIRTUAL_ENV)"
	@echo ""
	@echo "Key dependencies:"
	@pip show google-genai 2>/dev/null | grep Version || echo "❌ google-genai not installed"
	@pip show pytest 2>/dev/null | grep Version || echo "❌ pytest not installed"
	@echo ""
	@echo "Environment:"
	@[ -f .env ] && echo "✅ .env file exists" || echo "❌ .env file missing"
	@[ -n "$$GOOGLE_API_KEY" ] && echo "✅ GOOGLE_API_KEY set" || echo "❌ GOOGLE_API_KEY not set" 