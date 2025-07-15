# VoiceTree Call Graph

This diagram shows the main flow of the VoiceTree system from entry point through the processing pipeline.

```mermaid
graph TD
    A[main<br/>quality_LLM_benchmarker.py:69] --> B[run_quality_benchmark<br/>quality_LLM_benchmarker.py:22]
    B --> C[TranscriptProcessor.process_content<br/>transcript_processor.py:59]
    C --> D[ChunkProcessor.process_and_convert<br/>chunk_processor.py:79]
    D --> E[BufferManager.process_stream<br/>buffer_manager.py]
    E --> F[ChunkProcessor._process_text_chunk<br/>chunk_processor.py:128]
    F --> G[ChunkProcessor._process_with_workflow<br/>chunk_processor.py:138]
    G --> H[WorkflowAdapter.process_transcript<br/>workflow_adapter.py:43]
    H --> I[VoiceTreeAgent.run<br/>voice_tree.py:68]
    I --> J[Agent.execute<br/>agent.py]
    J --> K[segmentation_node<br/>nodes.py:14]
    K --> L[relationship_analysis_node<br/>nodes.py:19]
    L --> M[integration_decision_node<br/>nodes.py:24]
    M --> N[VoiceTreeAgent._extract_new_nodes<br/>voice_tree.py:124]
    N --> O[ChunkProcessor._apply_integration_decisions<br/>chunk_processor.py:176]
    O --> P[DecisionTree operations<br/>decision_tree_ds.py]
    C --> Q[ChunkProcessor.finalize<br/>chunk_processor.py:240]
    Q --> R[TreeToMarkdownConverter.convert_tree<br/>tree_to_markdown.py]
    R --> S[Save markdown files<br/>to output directory]

    style A fill:#f9f,stroke:#333,stroke-width:4px
    style K fill:#bbf,stroke:#333,stroke-width:2px
    style L fill:#bbf,stroke:#333,stroke-width:2px
    style M fill:#bbf,stroke:#333,stroke-width:2px
    style S fill:#bfb,stroke:#333,stroke-width:2px
```

## Key Components

### Entry Points
- **main()**: Entry point for quality benchmarking system
- **run_quality_benchmark()**: Orchestrates the benchmarking process

### Processing Pipeline
- **TranscriptProcessor**: Manages transcript processing workflow
- **ChunkProcessor**: Core processor that handles text chunks and coordinates components
- **BufferManager**: Manages text buffering and chunk creation
- **WorkflowAdapter**: Bridges between chunk processing and agentic workflow

### Agentic Workflow
- **VoiceTreeAgent**: Implements the LangGraph workflow
- **Nodes**: Three processing nodes in sequence:
  - `segmentation_node`: Segments text into distinct ideas
  - `relationship_analysis_node`: Analyzes relationships between segments
  - `integration_decision_node`: Decides how to integrate into tree structure

### Output Generation
- **DecisionTree**: Maintains the tree structure of ideas
- **TreeToMarkdownConverter**: Converts tree to markdown files
- **Output**: Generated markdown files saved to output directory