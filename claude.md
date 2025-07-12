# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VoiceTree is a Python backend system that converts voice input into structured graphs using an LLM agentic pipeline. The system transcribes audio, processes it through agentic workflows, and outputs interconnected markdown files representing ideas as a visual tree.

## Essential Commands

# Run unit tests
pytest backend/tests/unit_tests

# Run integration tests
pytest backend/tests/integration_tests/

# Run benchmarker for quality testing
python backend/benchmarker/src/quality_LLM_benchmarker.py
```


## Architecture & Code Structure

For detailed architecture information, see the "Current Architecture" section in README-dev.md.

## Development Philosophy

### Key Rules
1. **Single Solution Principle**: Never have more than 1 solution for the same problem. Instead, evolve the system incrementally towards the desired state. Never have fallbacks. Do not keep legacy or deprecated code in the codebase.
2. **Minimize Complexity**: When adding features, reduce complexity by re-architecting, introducing abstractions that hide complexity and separating concerns.
3. **Quality Testing**: Add high quality unit tests for any non-trivial changes. These will undergo mutation testing. However, keep the tests general enough that minor changes (non functional) don't break the unit tests. Make sure all added tests are providing real value, and not just overhead and complexity.
4. **Fail Fast**: No complex error handling during development

## Development Guidelines

For quality debugging workflow and development philosophy, see README-dev.md.

## Key Documentation

For deeper understanding, read these files in order:
1. `README-dev.md` - High-level developer overview
2. `backend/benchmarker/Benchmarker_Agentic_feedback_loop_guide.md` - Primary developer guide for improving system and handling benchmarker results.
4. `backend/README-dev.md` - Backend architecture details
5. Component-specific `README-dev.md` files in major directories

