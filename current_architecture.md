# VoiceTree Current Architecture

## System Overview

VoiceTree is a voice-to-knowledge-graph system that converts spoken input into structured markdown files organized as a tree. The system uses a 4-stage agentic pipeline to process voice input in real-time.

## High-Level System Flow

```mermaid
flowchart TB
    subgraph "Voice Input"
        VI[Voice Input] --> VTE[VoiceToTextEngine]
        VTE --> AQ[Audio Queue]
    end
    
    subgraph "Main Loop"
        AQ --> PQ[process_audio_queue]
        PQ --> Trans[Transcription]
    end
    
    subgraph "Processing Pipeline"
        Trans --> TP[TranscriptionProcessor]
        TP --> WTM[WorkflowTreeManager]
        WTM --> UBM[UnifiedBufferManager]
        UBM --> WA[WorkflowAdapter]
    end
    
    subgraph "Agentic Workflow"
        WA --> AP[Agentic Pipeline<br/>4 Stages]
    end
    
    subgraph "Output Generation"
        AP --> TM[Tree Manager]
        TM --> TMC[TreeToMarkdownConverter]
        TMC --> MD[Markdown Files]
    end
```

## Component Details

### 1. Entry Point (main.py)
- Initializes core components:
  - `DecisionTree`: Tree data structure
  - `WorkflowTreeManager`: Orchestrates the pipeline
  - `TreeToMarkdownConverter`: Converts tree to markdown
  - `TranscriptionProcessor`: Processes transcriptions
- Runs async main loop that:
  - Polls audio queue for transcriptions
  - Processes transcriptions through the pipeline
  - Converts results to markdown files

### 2. Voice to Text Component

```mermaid
flowchart LR
    subgraph "VoiceToTextEngine"
        MIC[Microphone] --> RC[record_callback]
        RC --> DQ[data_queue]
        DQ --> PAQ[process_audio_queue]
        PAQ --> W[Whisper Model]
        W --> T[Transcription Text]
    end
```

Key features:
- Uses Whisper model (large-v3 or distil-large-v3)
- Audio buffering with timeout detection
- Continuous listening with callback mechanism

### 3. Text Buffer Management

```mermaid
flowchart TB
    subgraph "UnifiedBufferManager"
        IT[Input Text] --> AT[add_text]
        AT --> DEC{Should Process<br/>Immediately?}
        DEC -->|Yes| IMM[Return Text]
        DEC -->|No| BUF[Buffer Text]
        BUF --> TH{Threshold<br/>Reached?}
        TH -->|Yes| PROC[Process Buffer]
        TH -->|No| WAIT[Wait for More]
        
        ICR[Incomplete Chunk<br/>Remainder] -.-> AT
    end
```

Buffer characteristics:
- Adaptive processing based on input patterns
- Buffer threshold: 83 characters
- Handles incomplete chunks between processing cycles
- Maintains transcript history for context

### 4. Workflow Processing Pipeline

```mermaid
flowchart TB
    subgraph "WorkflowTreeManager"
        PVI[process_voice_input] --> BM[Buffer Manager]
        BM --> TC[Text Chunk]
        TC --> PTW[_process_with_workflow]
        PTW --> WA[WorkflowAdapter]
        WA --> Result[WorkflowResult]
        Result --> ANA[_apply_node_actions]
    end
```

### 5. Agentic Workflow (4 Stages)

```mermaid
flowchart TB
    subgraph "Agentic Pipeline"
        direction TB
        T[Transcript] --> S1[Stage 1: Segmentation]
        S1 --> C[Atomic Idea Chunks]
        C --> S2[Stage 2: Relationship Analysis]
        S2 --> R[Node Relationships]
        R --> S3[Stage 3: Integration Decision]
        S3 --> D[CREATE/APPEND Actions]
        D --> S4[Stage 4: Node Extraction]
        S4 --> N[Tree Nodes]
    end
```

Stage details:
1. **Segmentation**: Breaks transcript into atomic ideas
2. **Relationship Analysis**: Analyzes connections to existing nodes
3. **Integration Decision**: Decides CREATE vs APPEND actions
4. **Node Extraction**: Creates final tree structure

### 6. Tree Operations & Output

```mermaid
flowchart LR
    subgraph "Tree Management"
        NA[Node Actions] --> DT[DecisionTree]
        DT --> TMC[TreeToMarkdownConverter]
        TMC --> MF[Markdown Files]
        
        DT --> |Updates| NTU[nodes_to_update Set]
        NTU --> |Selective| TMC
    end
```

## Data Flow Sequence

```mermaid
sequenceDiagram
    participant V as Voice
    participant VTE as VoiceToTextEngine
    participant M as Main Loop
    participant TP as TranscriptionProcessor
    participant WTM as WorkflowTreeManager
    participant BM as BufferManager
    participant WA as WorkflowAdapter
    participant AP as Agentic Pipeline
    participant TM as TreeManager
    participant MD as Markdown

    V->>VTE: Audio Input
    VTE->>VTE: Buffer & Process
    VTE->>M: Transcription
    M->>TP: process_and_convert()
    TP->>WTM: process_voice_input()
    WTM->>BM: add_text()
    BM->>BM: Check threshold
    BM-->>WTM: Text chunk (if ready)
    WTM->>WA: process_transcript()
    WA->>AP: Run 4-stage pipeline
    AP-->>WA: Node actions
    WA-->>WTM: WorkflowResult
    WTM->>TM: Apply node actions
    WTM->>TP: nodes_to_update
    TP->>MD: Convert to markdown
```

## Key Configuration

- **LLM Models**: 
  - Primary: `gemini-2.5-pro-preview-06-05`
  - Fast: `gemini-2.0-flash`
- **Voice Model**: `large-v3` (alt: `distil-large-v3`)
- **Buffer Threshold**: 83 characters
- **Recent Nodes Context**: 10

## Architecture Insights

1. **Streaming Architecture**: The system processes voice input in a streaming fashion, buffering text until meaningful chunks are ready for processing.

2. **Adaptive Processing**: The buffer manager adaptively decides whether to process immediately or buffer based on input characteristics.

3. **Stateful Tree Management**: The WorkflowTreeManager maintains state across processing cycles, tracking which nodes need updates.

4. **Modular Design**: Clear separation between voice capture, text processing, agentic workflow, and output generation.

5. **Async Processing**: Uses Python's asyncio for non-blocking operation, allowing continuous voice capture while processing.

## File Structure

```
backend/
├── main.py                           # Entry point (imports from parent)
├── process_transcription.py          # Transcription processor
├── voice_to_text/
│   └── voice_to_text.py             # Voice capture & transcription
├── tree_manager/
│   ├── workflow_tree_manager.py      # Main workflow orchestrator
│   ├── unified_buffer_manager.py     # Text buffering logic
│   ├── decision_tree_ds.py          # Tree data structure
│   └── tree_to_markdown.py          # Markdown conversion
├── workflow_adapter.py               # Agentic workflow adapter
└── text_to_graph_pipeline/          # Agentic workflow implementation
    └── agentic_workflows/           # 4-stage pipeline
```