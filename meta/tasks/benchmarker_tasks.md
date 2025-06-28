# Benchmarker Tasks

## High Priority

- [x] **Fix transcript_history always empty**
  - ~~Issue: `transcript_history: ''` is always empty in segmentation_debug.txt~~
  - ~~Root cause: TextBufferManager maintains transcript history but it's not passed to workflow~~
  - ~~Need to propagate transcript history from BufferManager → ChunkProcessor → WorkflowAdapter → Pipeline~~
  - FIXED: transcript_history is now properly passed through the pipeline
  - NOTE: Empty in benchmarker output because it's testing word-by-word processing

- [x] **Fix duplicate content with incomplete chunks**
  - ~~Issue: When `is_complete: False`, next iteration has incomplete section duplicated~~
  - ~~Example: "I'm going to save this file..." appears 4 times in segmentation output~~
  - ~~Root cause: ChunkProcessor prepends incomplete_chunk_remainder as raw text, causing duplication~~
  - ~~Need proper incomplete chunk merging in BufferManager~~
  - FIXED: Centralized buffer management in TextBufferManager with clean API
  - NOTE: Some duplication seen in benchmarker output is due to benchmarker bug (processing buffer twice)

- [x] **Fix duplicate nodes in integration decisions**
  - ~~Issue: Same content creates multiple identical nodes~~
  - ~~Example: Two "Save and Upload File" nodes created from duplicate input~~
  - ~~Root cause: Duplicate content from incomplete chunk handling creates duplicate decisions~~
  - FIXED: Root cause was duplicate content in input, which is now handled properly

- [ ] **Investigate intermittent output generation failure**
  - Sometimes output not generated - need to determine root cause
  - Only investigate if it happens again

- [x] **Fix debug logs growing indefinitely**
  - ~~Location: `backend/text_to_graph_pipeline/agentic_workflows/debug_logs`~~
  - ~~Need to implement log rotation or cleanup mechanism~~
  - DONE: Simplified to clear all logs at start of each execution

- [ ] **Fix segmentation prompt truncating text with '...'**
  - Example: `'text': 'And I want first, I want it to build into markdown, convert that into markdown, and then I want to c...'`
  - Investigate if this is due to predefined output token length
  - Consider restructuring to return delimiter locations instead of full text, or maybe we can reconstruct the full sentence deterministically based on the clues 

## Medium Priority

- [x] **Fix benchmarker processing buffer twice**
  - ~~Issue: TranscriptProcessor processes remaining buffer content after word-by-word processing~~
  - ~~This causes duplicate content in the test output~~
  - ~~Location: `backend/benchmarker/quality_tests/transcript_processor.py` line 96~~
  - ~~Solution: Remove the redundant buffer processing or ensure it's not duplicating content~~
  - FIXED: Redundant buffer processing has been commented out

- [ ] **Move benchmarker output location**
  - Current: various locations
  - Target: `backend/benchmarker/output/`
  - Also create sibling `backend/benchmarker/input/` folder

- [x] **Consolidate duplicated stage naming**
  - ~~Currently have: `stage_name`, `stage_type`, `prompt_name`~~
  - ~~Should use only one consistent naming convention~~
  - DONE: Now using single stage identifier with minimal mapping for schema lookup

- [ ] **Fix over-spamming of parent links**
  - Issue in relationship analysis stage
  - Example: See `markdownTreeVault/2025-06-22/2_VoiceTree_for_Therapy.md`
  - Too many parent relationships being created