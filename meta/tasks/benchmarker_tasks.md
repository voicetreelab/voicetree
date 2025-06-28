# Benchmarker Tasks

## High Priority

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