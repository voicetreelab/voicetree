# VoiceTreePoc - Development Guide

## Overview

VoiceTreePoc is a voice-to-knowledge-graph system that transforms spoken input into structured markdown knowledge trees through an agentic workflow pipeline.

## System Architecture


### Tree-action-decider agent:
The purpose of this agentic workflow is to proces small chunks of text (1-3 sentences) and update a tree representation of the text. 

The agent has two actions either append content to an existing node, or create a new node in the tree.

The agent consists of four stages, each having their own prompt.

```
Voice Input → Transcription → 4-Stage Agentic Workflow → Knowledge Tree → Markdown Files
```

**Core Pipeline Stages:**
1. **Segmentation** - Breaks transcripts into atomic ideas
2. **Relationship Analysis** - Analyzes connections to existing knowledge  
3. **Integration Decision** - Decides CREATE vs APPEND actions
4. **Node Extraction** - Creates final knowledge tree structure


### tree-reorganizing-agent

todo, new agent being created that automatically optimises the tree. i.e. takes (tree_structure, histortical_text) -> optimized_tree_structure. 

Optimized means more understandable, more concise, better represents the structure of the ideas being solved.

See /readme



## Directory Structure & Development Guides

### 🏗️ Core System Components

- **[`backend/`](backend/README-dev.md)** - Core system architecture, main entry points, and business logic
  - Main system orchestration and configuration
  - Voice-to-text processing
  - Enhanced transcription processing with TADA + TROA agents

- **[`backend/tree_manager/`](backend/tree_manager/README-dev.md)** - Tree data structures and buffer management
  - Decision tree data structures (`DecisionTree`)
  - Unified buffer management for streaming input
  - Tree-to-markdown conversion
  - Enhanced workflow integration

- **[`backend/agentic_workflows/`](backend/agentic_workflows/README-dev.md)** - 4-stage LLM processing pipeline
  - LangGraph-based workflow execution
  - State management across pipeline stages
  - LLM integration (Gemini API)
  - Workflow visualization and debugging

- **[`backend/benchmarker/`](backend/benchmarker/README-dev.md)** - Quality testing and performance measurement
  - 4-stage quality scoring framework
  - Automated benchmarking system
  - Performance regression detection
  - Debugging and analysis tools

### 📁 Supporting Directories

- **`tools/`** - Development utilities and scripts
- **`meta/`** - Project metadata, tasks, and memories
- **`debug_output/`** - System debug outputs and logs
- **`markdownTreeVault/`** - Generated knowledge tree markdown files
- **`unified_benchmark_reports/`** - Quality assessment reports

## Developer Onboarding

To get a comprehensive understanding of the VoiceTree project for development, a new contributor should read the following documents in this specific order:

1.  **[`README-dev.md`](README-dev.md)** (This file)
    *   **Purpose**: High-level developer overview, directory structure, and development philosophy.
    *   **Why first?**: Provides the map to all other documentation and key development commands.

2.  **[`backend/benchmarker/Benchmarker_Agentic_feedback_loop_guide.md`](backend/benchmarker/Benchmarker_Agentic_feedback_loop_guide.md)**
    *   **Purpose**: The primary guide for developers. It explains how to test, debug, and improve the agentic workflows.
    *   **Why second?**: It introduces the core developer loop of testing and analysis, which is crucial for making meaningful contributions.

3.  **[`backend/ARCHITECTURE_SUMMARY.md`](backend/ARCHITECTURE_SUMMARY.md)**
    *   **Purpose**: Provides a detailed look at the backend implementation and how the components fit together.
    *   **Why third?**: After understanding the high-level concepts and the development workflow, this document dives into the specific components and their interactions.
    
4. **[`DEVELOPMENT_SPEED_GUIDE.md`](DEVELOPMENT_SPEED_GUIDE.md)**
    * **Purpose**: Explains how to run tests efficiently to get fast feedback.
    * **Why fourth?**: Once you understand the architecture, this guide helps you become a productive developer by speeding up your test-and-debug cycles.

## Quick Start

### Prerequisites

```bash
# Install dependencies
pip install -r requirements.txt

# Set up API key
export GOOGLE_API_KEY="your_gemini_api_key"
```

### Basic Usage

```bash
# Run the main system
python backend/main.py

# Run quality tests (atomic test command)
make test-benchmarker

# Run specific component tests
python -m backend.tests.unit_tests
python -m backend.tests.integration_tests
```

## Development Philosophy

According to project memories, VoiceTree follows these key principles:

- **Atomic Testing**: Complex systems must be testable with a single command (`make test-benchmarker`)
- **Import System Integrity**: Robust import handling supporting multiple execution contexts (fixed from 40+ `sys.path.append()` hacks)
- **4-Stage Quality Scoring**: Granular performance tracking across segmentation, relationship analysis, integration decisions, and node extraction
- **Fail-Fast CI/CD**: 3-tier testing approach (unit → integration → API tests) with cost-controlled API gating

## System Status

- **Current Architecture**: Enhanced with TADA (real-time, 2.5-3/5 quality) + TROA (background optimization, 5/5 quality) agents
- **Testing**: Comprehensive 4-stage scoring framework with regression detection
- **Performance**: Voice Input → TADA (2.5-3/5) → TROA (5/5) quality progression

## Key Files

- `backend/main.py` - System entry point
- `backend/enhanced_transcription_processor.py` - Enhanced processing with dual agents
- `backend/workflow_adapter.py` - Bridge between backend and agentic workflows
- `Makefile` - Build and test commands
- `requirements.txt` - Python dependencies

## Navigation

- 📖 **[Backend Architecture](backend/README-dev.md)** - Core system components
- 🌳 **[Tree Management](backend/tree_manager/README-dev.md)** - Data structures and buffer management  
- 🤖 **[Agentic Workflows](backend/agentic_workflows/README-dev.md)** - LLM processing pipeline
- 📊 **[Quality & Benchmarking](backend/benchmarker/README-dev.md)** - Testing and performance measurement

For specific development tasks, see `meta/current_tasks/` for active work and `meta/memories/` for architectural decisions and lessons learned. 