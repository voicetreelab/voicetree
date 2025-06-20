# Benchmarker - Quality Testing & Performance Measurement

## Overview

The `benchmarker` module provides a comprehensive suite of tools for quality testing, performance measurement, and debugging of the VoiceTree agentic workflow pipeline. It is essential for maintaining system quality and detecting performance regressions.

## Architecture

```
benchmarker/
├── unified_voicetree_benchmarker.py    # Main end-to-end benchmarking system
├── debug_workflow.py                   # 4-stage workflow quality scoring
├── quality/                            # Quality assessment components
├── quality_tests/                      # Quality testing scripts
├── unified_benchmark_reports/          # Generated benchmark reports
└── Benchmarker_Agentic_feedback_loop_guide.md # Detailed guide for feedback loop
```

## Core Components

### 📊 End-to-End Benchmarking

#### `unified_voicetree_benchmarker.py`
**Purpose**: Main system for end-to-end quality and performance testing
- Simulates realistic transcript processing in chunks
- Orchestrates the full 4-stage agentic workflow
- Generates a complete knowledge tree from test data
- Produces detailed quality reports with composite scores

**Usage**:
```bash
# Atomic test command to run the full benchmark
make test-benchmarker
```

### 🎯 Quality Scoring Framework

#### `debug_workflow.py`
**Purpose**: Implements the 4-stage workflow quality scoring framework
- `WorkflowQualityScorer`: Core class for calculating quality scores
- Granular performance tracing for each pipeline stage
- Weighted composite scoring system
- Detailed score breakdowns for root cause analysis

**Key Classes**:
- `WorkflowQualityScorer`: Main scoring engine
- `StageScore`: Data structure for stage-specific scores

### 🧪 Quality Testing

#### `quality_tests/`
**Purpose**: Contains scripts and configurations for quality testing
- Test data and ground truth definitions
- Specialized testing scenarios
- Aider-based analysis and comparisons
- Historical quality test vaults

## 4-Stage Quality Scoring Framework

According to project memories, the benchmarking system uses a sophisticated 4-stage scoring framework to provide granular performance insights.

### Composite Score Calculation
The overall workflow score is a weighted average of the four pipeline stages:

```
Overall Score = (Segmentation × 20%) + (Relationship × 25%) + (Integration × 35%) + (Extraction × 20%)
```

### Stage-Specific Metrics

#### 1. Segmentation Quality (20% weight)
- **Content Completeness**: 40pts
- **Chunk Coherence**: 30pts
- **Boundary Logic**: 20pts
- **Size Appropriateness**: 10pts

#### 2. Relationship Analysis Quality (25% weight)
- **Context Quality**: 25pts
- **Relationship Detection**: 35pts
- **Relationship Strength**: 25pts
- **Conversation Flow**: 15pts

#### 3. Integration Decision Quality (35% weight)
- **Decision Balance**: 20pts
- **Content Quality**: 40pts
- **Decision Logic**: 25pts
- **Content Synthesis**: 15pts

#### 4. Node Extraction Quality (20% weight)
- **Name Quality**: 40pts
- **Name Uniqueness**: 20pts
- **Concept Accuracy**: 25pts
- **Hierarchy Awareness**: 15pts

## Development Philosophy

### Atomic Testing
The entire benchmarking system can be validated with a single atomic command, allowing for quick verification of system health without needing to understand the internal complexity.

```bash
make test-benchmarker
```

This command runs the full quality analysis pipeline, including:
- All 4 workflow stages
- Composite scoring with 16 sub-metrics
- Final report generation

### Granular Performance Tracing
The 4-stage scoring system is designed to trace poor overall performance back to specific pipeline stages. This allows for precise identification of bottlenecks in the voice-to-graph conversion process.

## How to Use the Benchmarker

### 1. Run the Main Benchmarker
Execute the atomic test command to get a full system quality report.

```bash
make test-benchmarker
```

### 2. Analyze the Report
Review the generated report in `unified_benchmark_reports/`.
- Check the overall composite score.
- Identify any stages with low scores.
- Drill down into the sub-metric scores to find the root cause of any quality issues.

### 3. Debug a Specific Stage
Use the `debug_workflow.py` script to run isolated tests on a specific stage of the pipeline. This allows for focused debugging and optimization.

```python
# Example of using the WorkflowQualityScorer directly
from backend.benchmarker.debug_workflow import WorkflowQualityScorer

scorer = WorkflowQualityScorer(ground_truth, pipeline_output)
segmentation_score = scorer.score_segmentation_quality()
print(f"Segmentation Score: {segmentation_score.overall_score}")
```

### 4. Implement Improvements
Based on the analysis, implement improvements in the relevant agentic workflow nodes or prompts.

### 5. Re-run and Compare
Re-run the benchmarker to verify that the changes have improved the quality score. Compare the new report with the previous one to track progress and prevent regressions.

## Navigation

- ← **[Backend Architecture](../README-dev.md)** - Core system overview
- 🌳 **[Tree Manager](../text_to_graph_pipeline/tree_manager/README-dev.md)** - Data structures and buffer management
- 🤖 **[Agentic Workflows](../text_to_graph_pipeline/agentic_workflows/README-dev.md)** - LLM processing pipeline
- ← **[Main Guide](../../README-dev.md)** - Project overview 