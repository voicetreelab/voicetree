# VoiceTree Testing Makefile
# Make it easy to run different test modes

.PHONY: help test-local test-ci test-all clean test-smoke test-fast test-unit test-watch

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
	@echo "🧪 Integration Test Modes:"
	@echo "  test-local     - 🏃 Local integration tests (limited API calls, ~25s)"
	@echo "  test-ci        - 🐌 Comprehensive CI tests (full API calls, ~60s)"
	@echo "  test-all       - 🔄 Run all test modes in sequence"
	@echo ""
	@echo "📊 Quality & Benchmarking:"
	@echo "  test-benchmarker - 📊 Test enhanced 4-stage scoring system (< 10s)"
	@echo "  test-quality-system - 🧪 Test quality scoring system (< 15s)"
	@echo ""
	@echo "Utilities:"
	@echo "  clean         - 🧹 Clean up test artifacts"
	@echo "  requirements  - 📦 Install/update dependencies"
	@echo ""
	@echo "Examples:"
	@echo "  make test-smoke     # Super quick smoke test (< 10s)"
	@echo "  make test-fast      # Quick dev testing (< 30s)" 
	@echo "  make test-unit      # Before committing (< 45s)"
	@echo ""
	@echo "💡 Philosophy: Unit tests for speed, integration tests for real API validation"

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

# Integration test commands (real API calls)
test-local:
	@echo "🏃 Running local integration tests (limited API calls, ~25s)..."
	@echo "💡 Tip: Make sure your .env file has GOOGLE_API_KEY set"
	cd backend/tests/integration_tests/agentic_workflows && \
	python -m pytest test_chunk_boundaries_adaptive.py test_real_examples.py \
		--test-mode=local \
		-v

test-ci:
	@echo "🐌 Running CI integration tests (comprehensive API calls, ~60s)..."
	@echo "💡 Tip: This makes real API calls and takes time"
	cd backend/tests/integration_tests/agentic_workflows && \
	python -m pytest test_chunk_boundaries_adaptive.py test_real_examples.py \
		--test-mode=ci \
		-v

test-all:
	@echo "🔄 Running all test modes..."
	@echo ""
	@make test-unit
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
	@echo "🏃 Local mode (limited API calls):"
	@time -p cd backend/tests/integration_tests/agentic_workflows && \
		python -m pytest test_chunk_boundaries_adaptive.py::test_chunk_boundaries_adaptive \
		--test-mode=local -v -q 2>/dev/null || true
	@echo ""
	@echo "🐌 CI mode (comprehensive API calls):"
	@time -p cd backend/tests/integration_tests/agentic_workflows && \
		python -m pytest test_chunk_boundaries_adaptive.py::test_chunk_boundaries_adaptive \
		--test-mode=ci -v -q 2>/dev/null || true

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

# Quality System Testing (BIBLE RULE #2: Single Atomic Correctness Command)
test-quality-system:
	@echo "🧪 Testing VoiceTree Quality Scoring System..."
	@python -c "from backend.benchmarker.quality import assess_workflow_quality; result = assess_workflow_quality(); print(f'✅ Quality System Working: {result.overall_score:.1f}/100')" && \
	python -m pytest backend/tests/ -k quality --quiet && \
	echo "✅ All quality tests passed - system is GREEN" || \
	(echo "❌ Quality system tests failed - system is RED" && exit 1)

# Enhanced Benchmarker Testing (BIBLE RULE #2: Single Atomic Correctness Command)
test-benchmarker:
	@echo "📊 Testing Enhanced VoiceTree Benchmarker System..."
	@echo "🔍 Testing 4-stage scoring system..."
	@python -c "from backend.benchmarker.debug_workflow import WorkflowQualityScorer, analyze_workflow_debug_logs; scorer = WorkflowQualityScorer(); print('✅ Scoring system initialized'); result = analyze_workflow_debug_logs(); print(f'✅ Analysis complete: {len(result.get(\"quality_scores\", {}))} stages scored')" && \
	echo "🧪 Testing unified benchmarker integration..." && \
	python -c "from backend.benchmarker.unified_voicetree_benchmarker import UnifiedVoiceTreeBenchmarker; benchmarker = UnifiedVoiceTreeBenchmarker(); print('✅ Unified benchmarker initialized'); analysis = benchmarker._run_enhanced_workflow_analysis(); print(f'✅ Enhanced analysis: {\"working\" if analysis else \"no debug logs found (expected)\"}');" && \
	echo "✅ Enhanced benchmarker system is GREEN - all components working" || \
	(echo "❌ Enhanced benchmarker system is RED - component failure detected" && exit 1) 